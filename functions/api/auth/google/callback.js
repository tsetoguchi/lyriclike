import {
  parseCookies, randomHex, secureCookieAttribute, writeLog,
} from '../../../_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request);

  if (!code || !state || state !== cookies.oauth_state) {
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
  const { sub, email, name } = await userRes.json();

  // Check if this is a new user before upserting so we can log signup vs login.
  const existing = await env.lyricalmiracle_db.prepare(
    'SELECT id FROM users WHERE google_sub = ?'
  ).bind(sub).first();

  const newId = crypto.randomUUID();
  await env.lyricalmiracle_db.prepare(`
    INSERT INTO users (id, google_sub, email, name, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name
  `).bind(newId, sub, email, name, Date.now()).run();

  const user = existing || await env.lyricalmiracle_db.prepare(
    'SELECT id FROM users WHERE google_sub = ?'
  ).bind(sub).first();

  await writeLog(env, request, { userId: user.id, event: existing ? 'login' : 'signup' });

  // Create a 30-day session.
  const sessionId = randomHex(32);
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(sessionId, user.id, expiresAt, Date.now()).run();

  const secure = secureCookieAttribute(url);

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie',
    `sid=${sessionId}; HttpOnly${secure}; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}; Path=/`
  );
  headers.append('Set-Cookie',
    `oauth_state=; HttpOnly${secure}; SameSite=Lax; Max-Age=0; Path=/`
  );

  return new Response(null, { status: 302, headers });
}
