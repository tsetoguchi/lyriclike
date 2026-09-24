const LOCAL_HOSTNAME = 'localhost';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;
const SESSION_REFRESH_WITHIN_MS = 5 * DAY_MS;
const SESSION_MAX_AGE_MS = 90 * DAY_MS;

export const SESSION_COOKIE_MAX_AGE = SESSION_LIFETIME_MS / 1000;

const SESSION_COOKIE = 'sid';
const SESSION_TOKEN_BYTES = 32;

const MAX_EMAIL_LENGTH = 254;

const IPV4_KEPT_OCTETS = 3;
const IPV6_KEPT_GROUPS = 3;
const IPV6_RATE_LIMIT_GROUPS = 4;
const IPV6_GROUP_COUNT = 8;

// Browsers reject Secure cookies over plain HTTP, which is what `wrangler
// pages dev` serves, so the attribute is dropped for local development only.
export function secureCookieAttribute(url) {
  return url.hostname === LOCAL_HOSTNAME ? '' : '; Secure';
}

// The one place that decides cookie flags. An empty value with maxAge 0 clears
// the cookie, and does so on http://localhost too, where a hardcoded Secure
// would make the browser ignore the clearing header.
export function cookieHeader(name, value, url, { maxAge }) {
  return `${name}=${value}; HttpOnly${secureCookieAttribute(url)}; SameSite=Lax; ` +
    `Max-Age=${maxAge}; Path=/`;
}

export function sessionCookie(value, url, { maxAge }) {
  return cookieHeader(SESSION_COOKIE, value, url, { maxAge });
}

export function clearedSessionCookie(url) {
  return sessionCookie('', url, { maxAge: 0 });
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  return Object.fromEntries(
    header.split(';')
      .map(c => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, v.join('=')])
  );
}

// The key accounts are matched on. Only case and surrounding spaces are folded:
// Gmail dots and "+" tags are left alone, since treating them as the same
// address is a known cause of accounts merging that should not. Returns null
// for anything that cannot be an address.
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) return null;

  const parts = email.split('@');
  return parts.length === 2 && parts[0] && parts[1] ? email : null;
}

export function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

export async function sha256Hex(value) {
  const bytes = await sha256Bytes(value);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// The uniform body of every failure from the password routes. Existing routes
// keep their empty bodies; only the new auth routes use this.
export function jsonError(status, code, message, headers) {
  return Response.json({ error: { code, message } }, { status, headers });
}

// Turns "2001:db8::1" into its eight groups. Returns null for anything that is
// not an IPv6 address.
function expandIpv6(ip) {
  if (!ip.includes(':')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = IPV6_GROUP_COUNT - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...new Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  return groups.every(g => /^[0-9a-f]{1,4}$/i.test(g)) ? groups : null;
}

// Splits an address into { v4: octets } or { v6: groups }, or null when it is
// neither. An IPv4-mapped IPv6 address ("::ffff:203.0.113.7") is an IPv4 client.
function parseIp(ip) {
  const mapped = ip.match(/^[0-9a-f:]*:(\d+\.\d+\.\d+\.\d+)$/i);
  const address = mapped ? mapped[1] : ip;

  const octets = address.split('.');
  if (octets.length === 4 && octets.every(o => /^\d{1,3}$/.test(o) && Number(o) <= 255)) {
    return { v4: octets };
  }

  const groups = expandIpv6(address);
  return groups ? { v6: groups } : null;
}

// Logs keep most of the abuse signal at a fraction of the identifiability:
// the /24 of an IPv4 address, the /48 of an IPv6 one.
export function truncateIp(ip) {
  if (typeof ip !== 'string' || !ip) return null;

  const parsed = parseIp(ip);
  if (!parsed) return null;
  if (parsed.v4) return [...parsed.v4.slice(0, IPV4_KEPT_OCTETS), '0'].join('.');
  return parsed.v6.slice(0, IPV6_KEPT_GROUPS).join(':').toLowerCase() + '::';
}

// Rate limits are the opposite trade. Truncating an IPv4 address to /24 would
// let a whole office or carrier NAT lock each other out, so the full address is
// the key. One IPv6 client holds a whole /64 and can rotate through it, so
// that is the key for IPv6.
export function rateLimitIp(ip) {
  if (typeof ip !== 'string' || !ip) return null;

  const parsed = parseIp(ip);
  if (!parsed) return null;
  if (parsed.v4) return parsed.v4.map(Number).join('.');
  const groups = parsed.v6.slice(0, IPV6_RATE_LIMIT_GROUPS).map(g => parseInt(g, 16).toString(16));
  return groups.join(':') + '::/64';
}

export async function writeLog(env, request, { userId, event }) {
  const ip = truncateIp(request.headers.get('CF-Connecting-IP'));
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO logs (id, user_id, event, ip, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId || null, event, ip, Date.now()).run();
}

// The cookie holds a random token; the database keeps only its hash, so a
// leaked copy of the table yields no usable session.
export async function createSession(env, userId) {
  const token = randomHex(SESSION_TOKEN_BYTES);
  const now = Date.now();
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(token), userId, now + SESSION_LIFETIME_MS, now).run();
  return token;
}

// A session that is close to running out is pushed out to 30 days from now,
// but never past 90 days after it was created. Returns the new cookie Max-Age
// in seconds, or null when nothing changed. The browser cookie has to be
// re-sent with it: extending only the database row leaves the cookie to expire
// on the old date.
async function extendSession(env, sessionId, session, now) {
  if (session.expires_at - now >= SESSION_REFRESH_WITHIN_MS) return null;

  const expiresAt = Math.min(now + SESSION_LIFETIME_MS, session.created_at + SESSION_MAX_AGE_MS);
  if (expiresAt <= session.expires_at) return null;

  await env.lyricalmiracle_db.prepare(
    'UPDATE sessions SET expires_at = ? WHERE id = ?'
  ).bind(expiresAt, sessionId).run();
  return Math.floor((expiresAt - now) / 1000);
}

// Returns { user, cookieMaxAge } for a live session, or null. With `refresh`,
// a session near its end is extended and cookieMaxAge says how long the
// cookie should now live; otherwise cookieMaxAge is null.
export async function getSession(request, env, { refresh = false } = {}) {
  const cookies = parseCookies(request);
  if (!cookies[SESSION_COOKIE]) return null;

  const sessionId = await sha256Hex(cookies[SESSION_COOKIE]);
  const now = Date.now();
  const session = await env.lyricalmiracle_db.prepare(
    'SELECT user_id, expires_at, created_at FROM sessions WHERE id = ? AND expires_at > ?'
  ).bind(sessionId, now).first();
  if (!session) return null;

  const user = await env.lyricalmiracle_db.prepare(
    'SELECT id, email, name FROM users WHERE id = ?'
  ).bind(session.user_id).first();
  if (!user) return null;

  const cookieMaxAge = refresh ? await extendSession(env, sessionId, session, now) : null;
  return { user, cookieMaxAge };
}

export async function getUser(request, env) {
  const session = await getSession(request, env);
  return session ? session.user : null;
}

// The preamble every signed-in route starts with. The 401 has an empty body on
// purpose, so existing routes answer a stranger and a missing session alike.
export async function requireUser(request, env, { refresh = false } = {}) {
  const session = await getSession(request, env, { refresh });
  if (!session) return { user: null, cookieMaxAge: null, response: new Response(null, { status: 401 }) };
  return { user: session.user, cookieMaxAge: session.cookieMaxAge, response: null };
}
