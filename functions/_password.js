// Password hashing and the rules a password has to meet.
//
// Stored form: pbkdf2-sha256$v1$<iterations>$<salt_b64>$<hash_b64>. The scheme
// prefix lets a later Argon2id arrive as a needsRehash bump, and "v1" names the
// pepper so it can be rotated without a reset.

export const PBKDF2_ITERATIONS = 100_000; // the most workerd allows
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

const SCHEME = 'pbkdf2-sha256';
const PEPPER_VERSION = 'v1';
const SALT_BYTES = 16;
const HASH_BITS = 256;
const COMPARE_KEY_BYTES = 32;
const STORED_PARTS = 5;
const MIN_LOCAL_PART_LENGTH = 4;

const HIBP_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 1500;
const HIBP_PREFIX_LENGTH = 5;

// A well-formed hash of nothing anyone knows, at the live parameters. Login
// checks it when the email is unknown or has no password, so those cases cost
// the same as a wrong password. It is a constant, not computed per isolate: a
// computed one would make the first unknown-email login in a cold isolate cost
// two hashes, which is a timing signal of its own. A test keeps its iteration
// count equal to PBKDF2_ITERATIONS.
export const DUMMY_HASH =
  'pbkdf2-sha256$v1$100000$Eh/r9e85JoFJTcVRZ7Jv6Q==$VulEhHDNM/mciAq7AUhc1unYvobEt/UNZcjHx7P33Wk=';

export const PASSWORD_PROBLEM = Object.freeze({
  TOO_SHORT: 'password_too_short',
  TOO_LONG: 'password_too_long',
  HAS_EMAIL: 'password_contains_email',
  BREACHED: 'password_breached',
});

export const PASSWORD_PROBLEM_MESSAGE = Object.freeze({
  [PASSWORD_PROBLEM.TOO_SHORT]: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  [PASSWORD_PROBLEM.TOO_LONG]: `Use at most ${MAX_PASSWORD_LENGTH} characters.`,
  [PASSWORD_PROBLEM.HAS_EMAIL]: "Don't use your email address in your password.",
  [PASSWORD_PROBLEM.BREACHED]: 'That password has appeared in a data breach. Choose another.',
});

const encoder = new TextEncoder();

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text) {
  try {
    return Uint8Array.from(atob(text), c => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(keyBytes) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

// Passwords are NFKC-normalised first: an accented character typed on iOS and
// on Windows can differ in bytes. The pepper is a server-side secret kept out
// of the database, applied as HMAC-SHA-256 before the slow hash.
async function pepperPassword(password, env) {
  if (!env.PASSWORD_PEPPER) throw new Error('PASSWORD_PEPPER is not set');
  const key = await hmacKey(encoder.encode(env.PASSWORD_PEPPER));
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(password.normalize('NFKC')));
  return new Uint8Array(mac);
}

async function derive(peppered, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

// Compares by HMAC-ing both values under a random per-call key and comparing
// the results, so the comparison leaks nothing. Works in workerd and in Node.
async function bytesEqual(a, b) {
  const key = await hmacKey(crypto.getRandomValues(new Uint8Array(COMPARE_KEY_BYTES)));
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, a), crypto.subtle.sign('HMAC', key, b),
  ]);
  const viewA = new Uint8Array(macA);
  const viewB = new Uint8Array(macB);
  let difference = viewA.length ^ viewB.length;
  for (let i = 0; i < viewA.length && i < viewB.length; i++) difference |= viewA[i] ^ viewB[i];
  return difference === 0;
}

function parseStoredHash(stored) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== STORED_PARTS || parts[0] !== SCHEME) return null;

  const iterations = Number(parts[2]);
  const salt = fromBase64(parts[3]);
  const hash = fromBase64(parts[4]);
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !hash) return null;
  return { version: parts[1], iterations, salt, hash };
}

export async function hashPassword(password, env) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(await pepperPassword(password, env), salt, PBKDF2_ITERATIONS);
  return [SCHEME, PEPPER_VERSION, PBKDF2_ITERATIONS, toBase64(salt), toBase64(hash)].join('$');
}

// Re-derives with the parameters the hash was stored with, so an older hash
// keeps verifying after the live parameters change.
export async function verifyPassword(password, stored, env) {
  if (typeof password !== 'string') return false;
  const parsed = parseStoredHash(stored);
  if (!parsed || parsed.version !== PEPPER_VERSION) return false;
  // workerd refuses more than the maximum, so such a hash cannot be checked here.
  if (parsed.iterations > PBKDF2_ITERATIONS) return false;

  const derived = await derive(await pepperPassword(password, env), parsed.salt, parsed.iterations);
  return bytesEqual(derived, parsed.hash);
}

// Callers rehash after a successful login when this is true.
export function needsRehash(stored) {
  const parsed = parseStoredHash(stored);
  return !parsed || parsed.version !== PEPPER_VERSION || parsed.iterations !== PBKDF2_ITERATIONS;
}

// Returns a PASSWORD_PROBLEM, or null when the password is acceptable. No
// composition rules and no expiry: length, the breach check and rate limits do
// the work. The address check skips very short local parts, which would
// otherwise reject most passwords.
export function checkPasswordPolicy(password, email) {
  if (typeof password !== 'string') return PASSWORD_PROBLEM.TOO_SHORT;
  const normalized = password.normalize('NFKC');
  const length = [...normalized].length;
  if (length < MIN_PASSWORD_LENGTH) return PASSWORD_PROBLEM.TOO_SHORT;
  if (length > MAX_PASSWORD_LENGTH) return PASSWORD_PROBLEM.TOO_LONG;

  const localPart = String(email).split('@')[0].normalize('NFKC').toLowerCase();
  if (localPart.length >= MIN_LOCAL_PART_LENGTH && normalized.toLowerCase().includes(localPart)) {
    return PASSWORD_PROBLEM.HAS_EMAIL;
  }
  return null;
}

async function sha1Upper(text) {
  const digest = await crypto.subtle.digest('SHA-1', encoder.encode(text));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Checks the password against Have I Been Pwned's range API: only the first five
// characters of its SHA-1 leave the Worker. `Add-Padding` hides how many real
// matches came back. A slow or failing service must not block signups, so any
// error counts as "not breached".
export async function isBreachedPassword(password) {
  if (typeof password !== 'string') return false;
  try {
    const digest = await sha1Upper(password.normalize('NFKC'));
    const prefix = digest.slice(0, HIBP_PREFIX_LENGTH);
    const suffix = digest.slice(HIBP_PREFIX_LENGTH);

    const response = await fetch(HIBP_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const lines = (await response.text()).split('\n');
    return lines.some((line) => {
      const [candidate, count] = line.trim().split(':');
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
