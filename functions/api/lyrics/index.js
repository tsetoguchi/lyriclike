import { requireUser } from '../../_shared.js';

// The notebook: this user's own pages, then the ones shared with them. Each
// group is newest first. Owned pages say how many people have them; shared
// ones say whose they are.
export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const db = env.lyricalmiracle_db;
  const [owned, shared] = await Promise.all([
    db.prepare(`
      SELECT id, title, updated_at, created_at,
        (SELECT count(*) FROM lyric_shares WHERE lyric_shares.lyric_id = lyrics.id) AS share_count
      FROM lyrics WHERE user_id = ? ORDER BY updated_at DESC
    `).bind(user.id).all(),
    db.prepare(`
      SELECT lyrics.id, lyrics.title, lyrics.updated_at, lyrics.created_at,
        COALESCE(NULLIF(users.name, ''), users.email) AS owner_name
      FROM lyric_shares
      JOIN lyrics ON lyrics.id = lyric_shares.lyric_id
      JOIN users ON users.id = lyrics.user_id
      WHERE lyric_shares.email_normalized = ? AND lyrics.user_id != ?
      ORDER BY lyrics.updated_at DESC
    `).bind(user.email_normalized, user.id).all(),
  ]);

  return Response.json([
    ...owned.results,
    ...shared.results.map(lyric => ({ ...lyric, shared: true, role: 'editor' })),
  ]);
}
