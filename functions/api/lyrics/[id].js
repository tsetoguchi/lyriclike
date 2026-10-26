import { requireUser, writeLog } from '../../_shared.js';
import { UNLIMITED, findLimits, isLimitsEnforced } from '../../_limits.js';
import { closeRoom, coWritersClause, evictFromRoom, isLivePage, isPausedFor } from '../../_live.js';
import {
  LIVE_COLUMNS, MAX_BODY_LENGTH, MAX_TITLE_LENGTH, findOpenable, notFound, paused, readJsonObject,
} from '../../_pages.js';
import { queuePageDeleted, queuePageSaved, snapshot, writeWithBefore } from '../../_page-events.js';
import { CAN_OPEN, canOpenParams } from '../../_shares.js';

const HTTP_OVER_LIMIT = 402;

// What the app needs to know about a page besides its words: whose it is,
// and how many people it is shared with, which turns on the poll and the
// "Shared with 3 people" line.
const PAGE_COLUMNS = `id, title, body, revision, updated_at, created_at, user_id AS owner_id,
  (SELECT count(*) FROM lyric_shares WHERE lyric_shares.lyric_id = lyrics.id) AS share_count,
  (SELECT COALESCE(NULLIF(users.name, ''), users.email) FROM users
    WHERE users.id = lyrics.user_id) AS owner_name`;

// The answer to a save that lost the race: what is on the server now, so the
// app can show the conflict bar, and "Keep mine" can retry on this revision.
function conflict(env, lyric) {
  return Response.json({
    error: 'conflict', body: lyric.body, title: lyric.title, revision: lyric.revision,
    live: isLivePage(env, lyric),
  }, { status: 409 });
}

export async function onRequestGet({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  // The poll on a shared page asks only whether anything changed, so it does
  // not send the whole page every few seconds.
  const metaOnly = new URL(request.url).searchParams.get('meta') === '1';
  if (metaOnly) {
    const meta = await findOpenable(env, params.id, user, `revision, title, updated_at, ${LIVE_COLUMNS}`);
    if (!meta) return notFound();
    const { revision, title, updated_at: updatedAt } = meta;
    return Response.json({
      revision, title, updated_at: updatedAt, live: isLivePage(env, meta), role: roleOf(meta.owner_id, user),
    });
  }

  const found = await findOpenable(env, params.id, user, PAGE_COLUMNS);
  if (!found) return notFound();
  const { owner_id: ownerId, ...lyric } = found;
  const role = roleOf(ownerId, user);
  if (role === 'editor') await recordFirstOpen(request, env, params.id, user);
  return Response.json({ ...lyric, role, live: isLivePage(env, found) });
}

function roleOf(ownerId, user) {
  return ownerId === user.id ? 'owner' : 'editor';
}

// Once per person, ever, for the growth numbers: did the invite get opened.
async function recordFirstOpen(request, env, id, user) {
  const opened = await env.lyricalmiracle_db.prepare(`
    UPDATE lyric_shares SET first_opened_at = ?, user_id = COALESCE(user_id, ?)
    WHERE lyric_id = ? AND email_normalized = ? AND first_opened_at IS NULL
  `).bind(Date.now(), user.id, id, user.email_normalized).run();
  if (opened.meta.changes > 0) await writeLog(env, request, { userId: user.id, event: 'share_opened' });
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// Returns the checked fields, or a Response when the payload is refused.
function readSave(payload) {
  if (!payload) return new Response('Invalid payload', { status: 400 });
  const { title, body, base_revision: baseRevision, overwrite = false } = payload;

  if (typeof body !== 'string') return new Response('Invalid payload', { status: 400 });
  if (typeof overwrite !== 'boolean') return new Response('Invalid payload', { status: 400 });
  if (title !== undefined && typeof title !== 'string')
    return new Response('Invalid payload', { status: 400 });
  if (baseRevision !== undefined && !isRevision(baseRevision))
    return new Response('Invalid payload', { status: 400 });
  if (title !== undefined && title.length > MAX_TITLE_LENGTH)
    return new Response('Title too long', { status: 413 });
  if (body.length > MAX_BODY_LENGTH)
    return new Response('Body too large', { status: 413 });

  return { title, body, baseRevision, overwrite };
}

// Saves the body. With base_revision it is an update, and only lands if
// nobody else saved since that revision. Without one it is a create, which
// never touches a page that already exists; the one exception is the bridge
// for tabs still running the old app, below.
export async function onRequestPut(context) {
  const { request, env, params } = context;
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const save = readSave(await readJsonObject(request));
  if (save instanceof Response) return save;

  const now = Date.now();
  return save.baseRevision === undefined
    ? createLyric(context, params.id, user, save, now)
    : updateLyric(context, params.id, user, save, now);
}

// One statement, so two saves on the same revision cannot both pass. The
// title is left alone: a stale tab must not undo someone's rename. The
// switch is checked in it too, so a paused co-writer's save never lands.
// "Keep mine" says so with overwrite; it still needs the right revision.
async function updateLyric(context, id, user, { body, baseRevision, overwrite }, now) {
  const { env } = context;
  const db = env.lyricalmiracle_db;
  const writers = coWritersClause(env);
  const { row: saved, before } = await writeWithBefore(env,
    () => db.prepare('SELECT title, body, updated_at FROM lyrics WHERE id = ? AND revision = ?')
      .bind(id, baseRevision),
    db.prepare(`
      UPDATE lyrics SET body = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND ${CAN_OPEN} AND (lyrics.user_id = ? OR ${writers.sql})
      RETURNING revision, title, ${LIVE_COLUMNS}
    `).bind(body, now, id, baseRevision, ...canOpenParams(user), user.id, ...writers.params));
  if (saved) {
    queuePageSaved(context, {
      pageId: id, ownerId: saved.owner_id, writerIds: [user.id],
      reason: overwrite ? 'overwrite' : 'edit',
      before: before && snapshot({ ...before, revision: baseRevision }),
      after: snapshot({ title: saved.title, body, revision: saved.revision, updated_at: now }),
    });
    return Response.json({ id, updated_at: now, revision: saved.revision, live: isLivePage(env, saved) });
  }

  const current = await findOpenable(env, id, user, `title, body, revision, ${LIVE_COLUMNS}`);
  if (!current) return notFound();
  return isPausedFor(env, user, current) ? paused() : conflict(env, current);
}

// The most new pages this user may have, or UNLIMITED when nothing is refused.
async function pageCap(env, user) {
  if (!isLimitsEnforced(env)) return UNLIMITED;
  const { pageLimit } = await findLimits(env, user.id);
  return pageLimit === null ? UNLIMITED : pageLimit;
}

function isTakenId(env, id) {
  return env.lyricalmiracle_db.prepare('SELECT 1 FROM lyrics WHERE id = ?').bind(id).first()
    .then(Boolean);
}

// The count sits inside the insert, so two tabs at 4 of 5 can't both pass.
// Only the user's own pages count, never pages shared with them.
async function createLyric(context, id, user, { title = '', body }, now) {
  const { env } = context;
  const cap = await pageCap(env, user);
  const created = await env.lyricalmiracle_db.prepare(`
    INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at)
    SELECT ?, ?, ?, ?, 0, ?, ?
    WHERE ? = ${UNLIMITED} OR (SELECT count(*) FROM lyrics WHERE user_id = ?) < ?
    ON CONFLICT(id) DO NOTHING
  `).bind(id, user.id, title, body, now, now, cap, user.id, cap).run();
  if (created.meta.changes > 0) {
    queuePageSaved(context, {
      pageId: id, ownerId: user.id, writerIds: [user.id], reason: 'edit',
      before: null, after: snapshot({ title, body, revision: 0, updated_at: now }),
    });
    return Response.json({ id, title, updated_at: now, revision: 0 });
  }

  // A retried create whose first answer was lost finds its own page here,
  // and takes the old-tab path rather than a refusal.
  if (!(await isTakenId(env, id))) {
    return Response.json({ error: 'page_limit', limit: cap }, { status: HTTP_OVER_LIMIT });
  }
  return saveFromOldTab(context, id, user, { title, body }, now);
}

// Tabs open during the deploy run the old app, which sends no revision and
// renames through this same save. For a week, an owner's save like that on a
// page nobody else has works as it used to: last write wins, title included.
// It still bumps the revision, so a new tab holding the old one gets a 409
// instead of silently saving over it. Remove once save_no_revision stops
// showing up in the logs.
async function saveFromOldTab(context, id, user, { title, body }, now) {
  const { request, env } = context;
  const db = env.lyricalmiracle_db;
  const { row: saved, before } = await writeWithBefore(env,
    () => db.prepare('SELECT title, body, revision, updated_at FROM lyrics WHERE id = ?').bind(id),
    db.prepare(`
      UPDATE lyrics SET title = ?, body = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND user_id = ?
        AND NOT EXISTS (SELECT 1 FROM lyric_shares WHERE lyric_id = ?)
      RETURNING revision
    `).bind(title, body, now, id, user.id, id));

  if (saved) {
    // A page gone by the time of the read has nothing to say before.
    if (before) {
      queuePageSaved(context, {
        pageId: id, ownerId: user.id, writerIds: [user.id], reason: 'edit',
        before: snapshot(before), after: snapshot({ title, body, revision: saved.revision, updated_at: now }),
      });
    }
    await writeLog(env, request, { userId: user.id, event: 'save_no_revision' });
    return Response.json({ id, title, updated_at: now, revision: saved.revision });
  }

  const current = await findOpenable(env, id, user, `title, body, revision, ${LIVE_COLUMNS}`);
  return current ? conflict(env, current) : notFound();
}

// Renames. No revision check and no bump: the last rename wins, which is fine
// for a title. updated_at moves, so the poll on a shared page sees it.
export async function onRequestPatch({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const payload = await readJsonObject(request);
  const title = payload && payload.title;
  if (typeof title !== 'string') return new Response('Invalid payload', { status: 400 });
  if (title.length > MAX_TITLE_LENGTH) return new Response('Title too long', { status: 413 });

  const now = Date.now();
  const writers = coWritersClause(env);
  const renamed = await env.lyricalmiracle_db.prepare(
    `UPDATE lyrics SET title = ?, updated_at = ?
     WHERE id = ? AND ${CAN_OPEN} AND (lyrics.user_id = ? OR ${writers.sql})`
  ).bind(title, now, params.id, ...canOpenParams(user), user.id, ...writers.params).run();
  if (renamed.meta.changes === 0) return refusedRename(env, params.id, user);

  return Response.json({ id: params.id, title, updated_at: now });
}

async function refusedRename(env, id, user) {
  const page = await findOpenable(env, id, user, LIVE_COLUMNS);
  if (!page) return notFound();
  return isPausedFor(env, user, page) ? paused() : notFound();
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  // Read before the batch removes them: a room exists only for a shared page.
  const shared = await env.lyricalmiracle_db.prepare(
    'SELECT 1 FROM lyric_shares WHERE lyric_id = ? LIMIT 1'
  ).bind(params.id).first();

  // The owner deletes the page and its share list; the owner check sits in
  // the share delete too, so nobody else can wipe a page's list this way. An
  // editor calling this only leaves: their own row goes, the page stays.
  // Parked event hook saves go with the page, so its words leave D1 too.
  const db = env.lyricalmiracle_db;
  const [, , pageDeleted, editorLeft] = await db.batch([
    db.prepare(
      'DELETE FROM event_outbox WHERE page_id IN (SELECT id FROM lyrics WHERE id = ? AND user_id = ?)'
    ).bind(params.id, user.id),
    db.prepare(
      'DELETE FROM lyric_shares WHERE lyric_id IN (SELECT id FROM lyrics WHERE id = ? AND user_id = ?)'
    ).bind(params.id, user.id),
    db.prepare('DELETE FROM lyrics WHERE id = ? AND user_id = ?').bind(params.id, user.id),
    db.prepare(
      'DELETE FROM lyric_shares WHERE lyric_id = ? AND email_normalized = ?'
    ).bind(params.id, user.email_normalized),
  ]);

  if (pageDeleted.meta.changes > 0) queuePageDeleted(context, params.id);
  if (shared && pageDeleted.meta.changes > 0) closeRoom(context, params.id);
  else if (editorLeft.meta.changes > 0) evictFromRoom(context, params.id, user.email_normalized);
  return new Response(null, { status: 204 });
}
