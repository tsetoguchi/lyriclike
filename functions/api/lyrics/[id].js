import { requireUser, writeLog } from '../../_shared.js';

const MAX_TITLE_LENGTH = 300;
const MAX_BODY_LENGTH = 500_000;

// Who can open a page. Every lyrics route asks the same question, so it is
// written once and bound as canOpenParams(user) after the page id.
const CAN_OPEN = 'user_id = ?';

function canOpenParams(user) {
  return [user.id];
}

function notFound() {
  return new Response(null, { status: 404 });
}

// The page as this user may see it, or null. Missing and not theirs look the
// same, so an id tells a stranger nothing.
function findOpenable(env, id, user, columns) {
  return env.lyricalmiracle_db.prepare(
    `SELECT ${columns} FROM lyrics WHERE id = ? AND ${CAN_OPEN}`
  ).bind(id, ...canOpenParams(user)).first();
}

// The answer to a save that lost the race: what is on the server now, so the
// app can show the conflict bar, and "Keep mine" can retry on this revision.
function conflict(lyric) {
  return Response.json(
    { error: 'conflict', body: lyric.body, title: lyric.title, revision: lyric.revision },
    { status: 409 });
}

export async function onRequestGet({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  // The poll on a shared page asks only whether anything changed, so it does
  // not send the whole page every few seconds.
  const metaOnly = new URL(request.url).searchParams.get('meta') === '1';
  const columns = metaOnly
    ? 'revision, title, updated_at'
    : 'id, title, body, revision, updated_at, created_at';

  const lyric = await findOpenable(env, params.id, user, columns);
  if (!lyric) return notFound();
  return Response.json(lyric);
}

// A body that is not a JSON object is the caller's mistake, so it gets a 400
// rather than an uncaught exception that Cloudflare reports as a server error.
async function readJsonObject(request) {
  try {
    const payload = await request.json();
    return payload !== null && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

// Returns the checked fields, or a Response when the payload is refused.
function readSave(payload) {
  if (!payload) return new Response('Invalid payload', { status: 400 });
  const { title, body, base_revision: baseRevision } = payload;

  if (typeof body !== 'string') return new Response('Invalid payload', { status: 400 });
  if (title !== undefined && typeof title !== 'string')
    return new Response('Invalid payload', { status: 400 });
  if (baseRevision !== undefined && !isRevision(baseRevision))
    return new Response('Invalid payload', { status: 400 });
  if (title !== undefined && title.length > MAX_TITLE_LENGTH)
    return new Response('Title too long', { status: 413 });
  if (body.length > MAX_BODY_LENGTH)
    return new Response('Body too large', { status: 413 });

  return { title, body, baseRevision };
}

// Saves the body. With base_revision it is an update, and only lands if
// nobody else saved since that revision. Without one it is a create, which
// never touches a page that already exists; the one exception is the bridge
// for tabs still running the old app, below.
export async function onRequestPut({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const save = readSave(await readJsonObject(request));
  if (save instanceof Response) return save;

  const now = Date.now();
  return save.baseRevision === undefined
    ? createLyric(request, env, params.id, user, save, now)
    : updateLyric(env, params.id, user, save, now);
}

// One statement, so two saves on the same revision cannot both pass. The
// title is left alone: a stale tab must not undo someone's rename.
async function updateLyric(env, id, user, { body, baseRevision }, now) {
  const saved = await env.lyricalmiracle_db.prepare(`
    UPDATE lyrics SET body = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND revision = ? AND ${CAN_OPEN}
    RETURNING revision
  `).bind(body, now, id, baseRevision, ...canOpenParams(user)).first();
  if (saved) return Response.json({ id, updated_at: now, revision: saved.revision });

  const current = await findOpenable(env, id, user, 'title, body, revision');
  return current ? conflict(current) : notFound();
}

async function createLyric(request, env, id, user, { title = '', body }, now) {
  const created = await env.lyricalmiracle_db.prepare(`
    INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(id, user.id, title, body, now, now).run();
  if (created.meta.changes > 0) return Response.json({ id, title, updated_at: now, revision: 0 });

  return saveFromOldTab(request, env, id, user, { title, body }, now);
}

// Tabs open during the deploy run the old app, which sends no revision and
// renames through this same save. For a week, an owner's save like that on a
// page nobody else has works as it used to: last write wins, title included.
// It still bumps the revision, so a new tab holding the old one gets a 409
// instead of silently saving over it. Remove once save_no_revision stops
// showing up in the logs.
async function saveFromOldTab(request, env, id, user, { title, body }, now) {
  const saved = await env.lyricalmiracle_db.prepare(`
    UPDATE lyrics SET title = ?, body = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND user_id = ?
      AND NOT EXISTS (SELECT 1 FROM lyric_shares WHERE lyric_id = ?)
    RETURNING revision
  `).bind(title, body, now, id, user.id, id).first();

  if (saved) {
    await writeLog(env, request, { userId: user.id, event: 'save_no_revision' });
    return Response.json({ id, title, updated_at: now, revision: saved.revision });
  }

  const current = await findOpenable(env, id, user, 'title, body, revision');
  return current ? conflict(current) : notFound();
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
  const renamed = await env.lyricalmiracle_db.prepare(
    `UPDATE lyrics SET title = ?, updated_at = ? WHERE id = ? AND ${CAN_OPEN}`
  ).bind(title, now, params.id, ...canOpenParams(user)).run();
  if (renamed.meta.changes === 0) return notFound();

  return Response.json({ id: params.id, title, updated_at: now });
}

export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  await env.lyricalmiracle_db.prepare(
    'DELETE FROM lyrics WHERE id = ? AND user_id = ?'
  ).bind(params.id, user.id).run();

  return new Response(null, { status: 204 });
}
