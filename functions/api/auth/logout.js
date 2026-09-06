import { parseCookies, getUser, writeLog } from '../../_shared.js';

export async function onRequestPost({ request, env }) {
  const user = await getUser(request, env);
  if (user) await writeLog(env, request, { userId: user.id, event: 'logout' });

  const cookies = parseCookies(request);
  if (cookies.sid) {
    await env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE id = ?').bind(cookies.sid).run();
  }

  const headers = new Headers();
  headers.append('Set-Cookie', 'sid=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  return new Response(null, { status: 200, headers });
}
