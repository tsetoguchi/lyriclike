// What the page routes share: the size limits, the columns that tell whether
// a page is live, and how a route finds a page the person may open.
import { CAN_OPEN, canOpenParams } from './_shares.js';

export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 500_000;

// Whose the page is and whether it is shared: together with the switch,
// whether the page is live.
export const LIVE_COLUMNS = `user_id AS owner_id,
  (SELECT count(*) FROM lyric_shares WHERE lyric_shares.lyric_id = lyrics.id) AS share_count`;

export function notFound() {
  return new Response(null, { status: 404 });
}

// A co-writer on a shared page while live editing is off: they may read,
// and only the owner writes (spec §8), so there is no conflict between people.
export function paused() {
  return Response.json({ error: 'paused' }, { status: 403 });
}

// The page as this user may see it, or null. Missing and not theirs look the
// same, so an id tells a stranger nothing.
export function findOpenable(env, id, user, columns) {
  return env.lyricalmiracle_db.prepare(
    `SELECT ${columns} FROM lyrics WHERE id = ? AND ${CAN_OPEN}`
  ).bind(id, ...canOpenParams(user)).first();
}

// A body that is not a JSON object is the caller's mistake, so it gets a 400
// rather than an uncaught exception that Cloudflare reports as a server error.
export async function readJsonObject(request) {
  try {
    const payload = await request.json();
    return payload !== null && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}
