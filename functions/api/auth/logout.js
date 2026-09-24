import {
  parseCookies, clearedSessionCookie, getUser, sha256Hex, writeLog,
} from '../../_shared.js';

export async function onRequestPost({ request, env }) {
  const user = await getUser(request, env);
  if (user) await writeLog(env, request, { userId: user.id, event: 'logout' });

  const cookies = parseCookies(request);
  if (cookies.sid) {
    await env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE id = ?')
      .bind(await sha256Hex(cookies.sid)).run();
  }

  const headers = new Headers();
  headers.append('Set-Cookie', clearedSessionCookie(new URL(request.url)));
  return new Response(null, { status: 200, headers });
}
