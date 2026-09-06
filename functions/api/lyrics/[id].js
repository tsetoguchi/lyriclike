import { getUser } from '../../_shared.js';

export async function onRequestGet({ request, env, params }) {
  const user = await getUser(request, env);
  if (!user) return new Response(null, { status: 401 });

  const lyric = await env.lyricalmiracle_db.prepare(
    'SELECT id, title, body, updated_at, created_at FROM lyrics WHERE id = ? AND user_id = ?'
  ).bind(params.id, user.id).first();

  if (!lyric) return new Response(null, { status: 404 });
  return Response.json(lyric);
}

export async function onRequestPut({ request, env, params }) {
  const user = await getUser(request, env);
  if (!user) return new Response(null, { status: 401 });

  const { title, body } = await request.json();

  if (typeof title !== 'string' || typeof body !== 'string')
    return new Response('Invalid payload', { status: 400 });
  if (title.length > 300)
    return new Response('Title too long', { status: 413 });
  if (body.length > 500_000)
    return new Response('Body too large', { status: 413 });

  const now = Date.now();

  await env.lyricalmiracle_db.prepare(`
    INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      body  = excluded.body,
      updated_at = excluded.updated_at
    WHERE lyrics.user_id = ?
  `).bind(params.id, user.id, title, body, now, now, user.id).run();

  return Response.json({ id: params.id, title, updated_at: now });
}

export async function onRequestDelete({ request, env, params }) {
  const user = await getUser(request, env);
  if (!user) return new Response(null, { status: 401 });

  await env.lyricalmiracle_db.prepare(
    'DELETE FROM lyrics WHERE id = ? AND user_id = ?'
  ).bind(params.id, user.id).run();

  return new Response(null, { status: 204 });
}
