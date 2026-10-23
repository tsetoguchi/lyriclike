// Live editing's switch, and the calls the site makes to a page's room.
// LIVE_EDITING is off, allowlist (page owners in LIVE_EDITING_USERS) or on.
// It goes by the page's owner, so everyone on one page is in the same mode.

const LIVE_ON = 'on';
const LIVE_ALLOWLIST = 'allowlist';
// The room routes on these paths; the origin is a placeholder, since a
// Durable Object stub ignores it.
const ROOM_ORIGIN = 'https://room';

function allowlist(env) {
  return new Set((env.LIVE_EDITING_USERS || '').split(',').map(id => id.trim()).filter(Boolean));
}

export function isLiveFor(env, ownerId) {
  if (env.LIVE_EDITING === LIVE_ON) return true;
  return env.LIVE_EDITING === LIVE_ALLOWLIST && allowlist(env).has(ownerId);
}

export function isLivePage(env, { owner_id: ownerId, share_count: shareCount }) {
  return Number(shareCount) > 0 && isLiveFor(env, ownerId);
}

// A co-writer on a shared page while the switch is off may only read.
export function isPausedFor(env, user, page) {
  return page.owner_id !== user.id && !isLivePage(env, page);
}

// Whether a shared page's co-writers may write, as SQL on lyrics.user_id,
// so a save checks the switch in the same statement that writes. The owner
// always may; with the switch off, co-writers only read (spec §8).
export function coWritersClause(env) {
  if (env.LIVE_EDITING === LIVE_ON) return { sql: '1', params: [] };
  const owners = env.LIVE_EDITING === LIVE_ALLOWLIST ? [...allowlist(env)] : [];
  if (!owners.length) return { sql: '0', params: [] };
  return { sql: `lyrics.user_id IN (${owners.map(() => '?').join(', ')})`, params: owners };
}

export function roomStub(env, lyricId) {
  return env.PAGE_ROOM.get(env.PAGE_ROOM.idFromName(lyricId));
}

// After the D1 change, in the background: a slow or failed room call must
// never fail the person's request, and the room's own re-check backs it up.
async function callRoom(env, lyricId, path, body) {
  if (!env.PAGE_ROOM) return;
  try {
    await roomStub(env, lyricId).fetch(`${ROOM_ORIGIN}${path}`, {
      method: 'POST', headers: { 'X-Room-Page': lyricId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    console.error('room call failed', path, err);
  }
}

// Waits for the room's answer, for a request that depends on it. Null when
// there is no room binding or the call fails, so the caller can say busy.
export async function askRoom(env, lyricId, path, body) {
  if (!env.PAGE_ROOM) return null;
  try {
    return await roomStub(env, lyricId).fetch(`${ROOM_ORIGIN}${path}`, {
      method: 'POST', headers: { 'X-Room-Page': lyricId }, body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('room call failed', path, err);
    return null;
  }
}

function runLater(context, promise) {
  if (typeof context.waitUntil === 'function') context.waitUntil(promise);
}

export function evictFromRoom(context, lyricId, emailNormalized) {
  // In the body, so the address stays out of the room's request logs.
  runLater(context, callRoom(context.env, lyricId, '/evict', { email: emailNormalized }));
}

export function closeRoom(context, lyricId) {
  runLater(context, callRoom(context.env, lyricId, '/close'));
}
