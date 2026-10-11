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

export function roomStub(env, lyricId) {
  return env.PAGE_ROOM.get(env.PAGE_ROOM.idFromName(lyricId));
}

// After the D1 change, in the background: a slow or failed room call must
// never fail the person's request, and the room's own re-check backs it up.
async function callRoom(env, lyricId, path) {
  if (!env.PAGE_ROOM) return;
  try {
    await roomStub(env, lyricId).fetch(`${ROOM_ORIGIN}${path}`, {
      method: 'POST', headers: { 'X-Room-Page': lyricId },
    });
  } catch (err) {
    console.error('room call failed', path, err);
  }
}

function runLater(context, promise) {
  if (typeof context.waitUntil === 'function') context.waitUntil(promise);
}

export function evictFromRoom(context, lyricId, emailNormalized) {
  runLater(context, callRoom(context.env, lyricId, `/evict?email=${encodeURIComponent(emailNormalized)}`));
}

export function closeRoom(context, lyricId) {
  runLater(context, callRoom(context.env, lyricId, '/close'));
}
