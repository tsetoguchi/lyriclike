// POST /api/lyrics/:id/replace — new words and a title over the whole page,
// for everyone on it. A live page is replaced by its room, so every screen
// changes at once; any other page by one guarded update here.
import { HOUR_MS, checkRateLimit, rateLimitedResponse } from '../../../_ratelimit.js';
import { askRoom, coWritersClause, isLivePage, isPausedFor } from '../../../_live.js';
import {
  LIVE_COLUMNS, MAX_BODY_LENGTH, MAX_TITLE_LENGTH, findOpenable, notFound, paused, readJsonObject,
} from '../../../_pages.js';
import { queuePageSaved, snapshot, writeWithBefore } from '../../../_page-events.js';
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
  return { title, body, tag: tag === undefined ? null : tag };
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
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
    if (isLivePage(env, page)) return replaceInRoom(env, params.id, user, words);
    const { row: saved, before } = await replaceInD1(env, params.id, user, words, page.revision);
    if (saved) {
      queueReplaced(context, params.id, user, words, { saved, before, revision: page.revision });
      return answer(params.id, words, saved, isLivePage(env, saved));
    }
  }
  return busy(HTTP_CONFLICT);
}

// Lands only on the revision just read, so a save in between is never
// written over blindly. The switch is checked in the same statement.
function replaceInD1(env, id, user, { title, body }, revision) {
  const db = env.lyricalmiracle_db;
  const writers = coWritersClause(env);
  const now = Date.now();
  return writeWithBefore(env,
    () => db.prepare('SELECT title, body, updated_at FROM lyrics WHERE id = ? AND revision = ?')
      .bind(id, revision),
    db.prepare(`
      UPDATE lyrics SET title = ?, body = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND ${CAN_OPEN} AND (lyrics.user_id = ? OR ${writers.sql})
      RETURNING revision, updated_at, ${LIVE_COLUMNS}
    `).bind(title, body, now, id, revision, ...canOpenParams(user), user.id, ...writers.params));
}

// A live page's room says so itself, with the words it held before.
function queueReplaced(context, id, user, { title, body, tag }, { saved, before, revision }) {
  queuePageSaved(context, {
    pageId: id, ownerId: saved.owner_id, writerIds: [user.id], reason: 'replace', tag,
    before: before && snapshot({ ...before, revision }),
    after: snapshot({ title, body, revision: saved.revision, updated_at: saved.updated_at }),
  });
}

// The room holds the page while it's live. An answer it doesn't give
// (none, or an older room's 426) means it can't take this yet. The tag and
// the person ride along for the room's page saved message.
async function replaceInRoom(env, id, user, { title, body, tag }) {
  const reply = await askRoom(env, id, '/replace', { title, body, tag, userId: user.id });
  if (!reply) return busy(HTTP_UNAVAILABLE);
  if (reply.status === HTTP_NOT_FOUND) return notFound();
  if (reply.status === HTTP_CONFLICT) return busy(HTTP_CONFLICT);
  if (reply.status !== HTTP_OK) return busy(HTTP_UNAVAILABLE);
  return answer(id, { title }, await reply.json(), true);
}

function answer(id, { title }, { revision, updated_at: updatedAt }, live) {
  return Response.json({ id, title, revision, updated_at: updatedAt, live });
}
