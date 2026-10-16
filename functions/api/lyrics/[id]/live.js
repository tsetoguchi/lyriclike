// GET /api/lyrics/:id/live — hands a page's WebSocket to its room. The
// session and access checks happen here, so the room never handles logins.
import { MINUTE_MS, checkRateLimit } from '../../../_ratelimit.js';
import { isLiveFor, roomStub } from '../../../_live.js';
import { getSession, parseCookies, sha256Hex } from '../../../_shared.js';
import { CAN_OPEN, canOpenParams } from '../../../_shares.js';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UPGRADE_REQUIRED = 426;
const HTTP_TOO_MANY_REQUESTS = 429;
// A buggy reconnect loop would otherwise spend the site-wide Pages allowance.
const CONNECTS_PER_MINUTE = 30;

// The forgery check in the middleware skips GETs, and an upgrade is a GET,
// so another site could otherwise open a socket carrying the cookie.
function isSameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

function openablePage(env, id, user) {
  return env.lyricalmiracle_db.prepare(`
    SELECT user_id AS owner_id,
      (SELECT count(*) FROM lyric_shares WHERE lyric_shares.lyric_id = lyrics.id) AS share_count
    FROM lyrics WHERE id = ? AND ${CAN_OPEN}
  `).bind(id, ...canOpenParams(user)).first();
}

// Header values must be Latin-1, so the name travels as base64 of UTF-8.
function encodeUser(user) {
  const json = JSON.stringify({ id: user.id, email: user.email_normalized, name: user.name });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

// A new request without the Cookie: the room has no use for the token.
async function roomRequest(request, user, lyricId) {
  const headers = new Headers({
    Upgrade: 'websocket',
    'X-Room-User': encodeUser(user),
    'X-Room-Session': await sha256Hex(parseCookies(request).sid),
    'X-Room-Page': lyricId,
  });
  return new Request(request.url, { headers });
}

function refuse(status, headers) {
  return new Response(null, { status, headers });
}

export async function onRequestGet({ request, env, params }) {
  if (request.headers.get('Upgrade') !== 'websocket') return refuse(HTTP_UPGRADE_REQUIRED);
  if (!isSameOrigin(request)) return refuse(HTTP_FORBIDDEN);
  const session = await getSession(request, env);
  if (!session) return refuse(HTTP_UNAUTHORIZED);
  const page = await openablePage(env, params.id, session.user);
  if (!page || !page.share_count || !isLiveFor(env, page.owner_id)) return refuse(HTTP_NOT_FOUND);
  const limit = await checkRateLimit(env, `live:connect:${session.user.id}`, CONNECTS_PER_MINUTE, MINUTE_MS);
  if (!limit.allowed) return refuse(HTTP_TOO_MANY_REQUESTS, { 'Retry-After': String(limit.retryAfterSeconds) });
  return roomStub(env, params.id).fetch(await roomRequest(request, session.user, params.id));
}
