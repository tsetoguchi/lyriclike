import { requireUser } from '../../_shared.js';

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const { results } = await env.lyricalmiracle_db.prepare(
    'SELECT id, title, updated_at, created_at FROM lyrics WHERE user_id = ? ' +
    'ORDER BY updated_at DESC'
  ).bind(user.id).all();

  return Response.json(results);
}
