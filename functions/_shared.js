const LOCAL_HOSTNAME = 'localhost';

// Browsers reject Secure cookies over plain HTTP, which is what `wrangler
// pages dev` serves, so the attribute is dropped for local development only.
export function secureCookieAttribute(url) {
  return url.hostname === LOCAL_HOSTNAME ? '' : '; Secure';
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

export function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function writeLog(env, request, { userId, event }) {
  const ip = request.headers.get('CF-Connecting-IP') || null;
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO logs (id, user_id, event, ip, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId || null, event, ip, Date.now()).run();
}

export async function getUser(request, env) {
  const cookies = parseCookies(request);
  if (!cookies.sid) return null;

  const session = await env.lyricalmiracle_db.prepare(
    'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?'
  ).bind(cookies.sid, Date.now()).first();

  if (!session) return null;

  return env.lyricalmiracle_db.prepare(
    'SELECT id, email, name FROM users WHERE id = ?'
  ).bind(session.user_id).first();
}
