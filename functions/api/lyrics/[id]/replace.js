// POST /api/lyrics/:id/replace — new words and a title over the whole page,
// for everyone on it. A live page is replaced by its room, so every screen
// changes at once; any other page by one guarded update here.
import { HOUR_MS, checkRateLimit, rateLimitedResponse } from '../../../_ratelimit.js';
import { askRoom, coWritersClause, isLivePage, isPausedFor } from '../../../_live.js';
import {
  LIVE_COLUMNS, MAX_BODY_LENGTH, MAX_TITLE_LENGTH, findOpenable, notFound, paused, readJsonObject,
} from '../../../_pages.js';
import { requireUser } from '../../../_shared.js';
import { CAN_OPEN, canOpenParams } from '../../../_shares.js';

const MAX_TAG_LENGTH = 64;
// A live replace diffs two texts up to the size cap in the room.
const REPLACES_PER_HOUR = 60;
// One retry after a save that landed between the read and the write.
const WRITE_ATTEMPTS = 2;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNAVAILABLE = 503;

function busy(status) {
  return Response.json({ error: 'busy' }, { status });
}

// Returns the checked words, or a Response when the payload is refused.
function readWords(payload) {
  if (!payload) return new Response('Invalid payload', { status: 400 });
  const { title, body, tag } = payload;
  if (typeof title !== 'string' || typeof body !== 'string') return new Response('Invalid payload', { status: 400 });
  if (tag !== undefined && (typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH)) {
    return new Response('Invalid payload', { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) return new Response('Title too long', { status: 413 });
  if (body.length > MAX_BODY_LENGTH) return new Response('Body too large', { status: 413 });
  return { title, body };
}

export async function onRequestPost({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const words = readWords(await readJsonObject(request));
  if (words instanceof Response) return words;

  const limit = await checkRateLimit(env, `replace:${user.id}`, REPLACES_PER_HOUR, HOUR_MS);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const page = await findOpenable(env, params.id, user, `revision, ${LIVE_COLUMNS}`);
    if (!page) return notFound();
    if (isPausedFor(env, user, page)) return paused();
    if (isLivePage(env, page)) return replaceInRoom(env, params.id, words);
    const saved = await replaceInD1(env, params.id, user, words, page.revision);
    if (saved) return answer(params.id, words, saved, isLivePage(env, saved));
  }
  return busy(HTTP_CONFLICT);
}

// Lands only on the revision just read, so a save in between is never
// written over blindly. The switch is checked in the same statement.
function replaceInD1(env, id, user, { title, body }, revision) {
  const writers = coWritersClause(env);
  const now = Date.now();
  return env.lyricalmiracle_db.prepare(`
    UPDATE lyrics SET title = ?, body = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND revision = ? AND ${CAN_OPEN} AND (lyrics.user_id = ? OR ${writers.sql})
    RETURNING revision, updated_at, ${LIVE_COLUMNS}
  `).bind(title, body, now, id, revision, ...canOpenParams(user), user.id, ...writers.params).first();
}

// The room holds the page while it's live. An answer it doesn't give
// (none, or an older room's 426) means it can't take this yet.
async function replaceInRoom(env, id, words) {
  const reply = await askRoom(env, id, '/replace', words);
  if (!reply) return busy(HTTP_UNAVAILABLE);
  if (reply.status === HTTP_NOT_FOUND) return notFound();
  if (reply.status === HTTP_CONFLICT) return busy(HTTP_CONFLICT);
  if (reply.status !== HTTP_OK) return busy(HTTP_UNAVAILABLE);
  return answer(id, words, await reply.json(), true);
}

function answer(id, { title }, { revision, updated_at: updatedAt }, live) {
  return Response.json({ id, title, revision, updated_at: updatedAt, live });
}
