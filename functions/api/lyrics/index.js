import { getUser } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env);
  if (!user) return new Response(null, { status: 401 });

  const { results } = await env.lyricalmiracle_db.prepare(
    'SELECT id, title, updated_at FROM lyrics WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(user.id).all();

  return Response.json(results);
}
