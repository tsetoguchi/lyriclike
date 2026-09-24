import {
  clearedSessionCookie, parseCookies, requireUser, sessionCookie, writeLog,
} from '../_shared.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function onRequestGet({ request, env, waitUntil }) {
  // The page calls this on every load, so it is where a session that is close
  // to running out gets its cookie renewed.
  const { user, cookieMaxAge, response } = await requireUser(request, env, { refresh: true });
  if (response) return response;

  // Clean up expired sessions and old logs in the background.
  const cutoff = Date.now() - NINETY_DAYS_MS;
  waitUntil(env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.lyricalmiracle_db.prepare('DELETE FROM logs WHERE created_at < ?').bind(cutoff),
  ]));

  const headers = new Headers();
  if (cookieMaxAge !== null) {
    const { sid } = parseCookies(request);
    headers.append('Set-Cookie', sessionCookie(sid, new URL(request.url), { maxAge: cookieMaxAge }));
  }
  return Response.json(user, { headers });
}

export async function onRequestDelete({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  await writeLog(env, request, { userId: user.id, event: 'delete_account' });

  await env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM lyrics WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM logs WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM identities WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);

  const headers = new Headers();
  headers.append('Set-Cookie', clearedSessionCookie(new URL(request.url)));
  return new Response(null, { status: 200, headers });
}
