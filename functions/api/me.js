import { getUser, writeLog } from '../_shared.js';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function onRequestGet({ request, env, waitUntil }) {
  const user = await getUser(request, env);
  if (!user) return new Response(null, { status: 401 });

  // Clean up expired sessions and old logs in the background.
  const cutoff = Date.now() - NINETY_DAYS_MS;
  waitUntil(env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.lyricalmiracle_db.prepare('DELETE FROM logs WHERE created_at < ?').bind(cutoff),
  ]));

  return Response.json(user);
}

export async function onRequestDelete({ request, env }) {
  const user = await getUser(request, env);
  if (!user) return new Response(null, { status: 401 });

  await writeLog(env, request, { userId: user.id, event: 'delete_account' });

  await env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM lyrics WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM logs WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);

  const headers = new Headers();
  headers.append('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  return new Response(null, { status: 200, headers });
}
