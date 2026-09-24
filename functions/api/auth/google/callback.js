import {
  SESSION_COOKIE_MAX_AGE, cookieHeader, createSession, normalizeEmail, parseCookies, sessionCookie,
  writeLog,
} from '../../../_shared.js';

const PROVIDER = 'google';
const HTTP_FORBIDDEN = 403;

function sql(env, text) {
  return env.lyricalmiracle_db.prepare(text);
}

function clearOauthCookies(headers, url) {
  headers.append('Set-Cookie', cookieHeader('oauth_state', '', url, { maxAge: 0 }));
  headers.append('Set-Cookie', cookieHeader('oauth_verifier', '', url, { maxAge: 0 }));
}

// Shown when Google will not vouch for the address. A bare 400 would look like
// a bug in the site.
function unverifiedEmailPage(url) {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  clearOauthCookies(headers, url);
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>Sign-in problem</title>' +
    '<p>Google has not verified the email address on that account, so we can\'t sign you in with it.</p>' +
    '<p><a href="/">Back to LyricLike</a></p>';
  return new Response(html, { status: HTTP_FORBIDDEN, headers });
}

function findIdentityUser(env, sub) {
  return sql(env, `
    SELECT users.id, users.email_normalized FROM identities
    JOIN users ON users.id = identities.user_id
    WHERE identities.provider = ? AND identities.provider_subject = ?
  `).bind(PROVIDER, sub).first();
}

function findUserByEmail(env, emailNormalized) {
  return sql(env, 'SELECT id, password_hash FROM users WHERE email_normalized = ?')
    .bind(emailNormalized).first();
}

function insertIdentity(env, userId, sub) {
  return sql(env, `
    INSERT INTO identities (id, user_id, provider, provider_subject, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId, PROVIDER, sub, Date.now());
}

function insertUser(env, userId, { email, emailNormalized, name }) {
  return sql(env, `
    INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(userId, email, emailNormalized, name || null, Date.now());
}

// Someone we already know signs in again, whatever Google says about the
// address now. The stored email is never overwritten from Google: it could be
// another account's address, and changing it is not something this sign-in
// gets to do.
async function signInKnownIdentity(env, request, known, profile) {
  if (profile.name) {
    await sql(env, 'UPDATE users SET name = ? WHERE id = ?').bind(profile.name, known.id).run();
  }
  if (known.email_normalized !== profile.emailNormalized) {
    await writeLog(env, request, { userId: known.id, event: 'oauth_email_differs' });
  }
  await writeLog(env, request, { userId: known.id, event: 'login' });
  return known.id;
}

// A local account holds this address and has no Google identity yet. Every
// local account has a proven email, so adding the identity hands the account to
// the one person who controls that mailbox.
async function linkToLocalAccount(env, request, local, sub) {
  await insertIdentity(env, local.id, sub).run();
  await writeLog(env, request, { userId: local.id, event: 'oauth_linked' });
  // When the account has a password (local.password_hash), the owner should be
  // told Google sign-in was added. That mail is sent from _email.js, which
  // arrives with password accounts; until then no account can have one.
  return local.id;
}

async function createGoogleUser(env, request, profile, sub) {
  const userId = crypto.randomUUID();
  await env.lyricalmiracle_db.batch([
    insertUser(env, userId, profile),
    insertIdentity(env, userId, sub),
  ]);
  await writeLog(env, request, { userId, event: 'signup' });
  return userId;
}

// Works out which account this Google sign-in belongs to and returns its id,
// or null when Google has not verified the address and there is no identity yet
// to vouch for the person instead.
async function resolveUser(env, request, profile, sub) {
  const known = await findIdentityUser(env, sub);
  if (known) return signInKnownIdentity(env, request, known, profile);
  if (!profile.emailVerified || !profile.emailNormalized) return null;

  const local = await findUserByEmail(env, profile.emailNormalized);
  try {
    return local
      ? await linkToLocalAccount(env, request, local, sub)
      : await createGoogleUser(env, request, profile, sub);
  } catch (err) {
    // A concurrent sign-in for the same person got there first, so the identity
    // or the address is now taken. Whatever it made is what this request wants.
    const raced = await findIdentityUser(env, sub) || await findUserByEmail(env, profile.emailNormalized);
    if (!raced) throw err;
    return raced.id;
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request);

  if (!code || !state || state !== cookies.oauth_state || !cookies.oauth_verifier) {
    return new Response('Invalid state', { status: 400 });
  }

  // Exchange the temporary code for an access token.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_REDIRECT_URL,
      code_verifier: cookies.oauth_verifier,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) return new Response('Token exchange failed', { status: 500 });
  const { access_token } = await tokenRes.json();

  // Use the token to fetch the user's Google profile.
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) return new Response('Failed to fetch user info', { status: 500 });
  const { sub, email, email_verified: emailVerified, name } = await userRes.json();

  // Matching an account by address is only safe when Google vouches for it.
  const profile = {
    email, name, emailNormalized: normalizeEmail(email), emailVerified: emailVerified === true,
  };
  const userId = await resolveUser(env, request, profile, sub);
  if (!userId) return unverifiedEmailPage(url);

  const sessionToken = await createSession(env, userId);

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie',
    sessionCookie(sessionToken, url, { maxAge: SESSION_COOKIE_MAX_AGE }));
  clearOauthCookies(headers, url);

  return new Response(null, { status: 302, headers });
}
