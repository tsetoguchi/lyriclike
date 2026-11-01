// GET /api/lyrics/:id/live — hands a page's WebSocket to its room. The
// session and access checks happen here, so the room never handles logins.
import { MINUTE_MS, checkRateLimit } from '../../../_ratelimit.js';
import { isLiveFor, roomStub } from '../../../_live.js';
import { SOCKET_TICKET, redeemAppTicket } from '../../../_app-tickets.js';
import { getSession, isAppOrigin, sessionTokenFrom, sha256Hex } from '../../../_shared.js';
import { CAN_OPEN, canOpenParams } from '../../../_shares.js';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UPGRADE_REQUIRED = 426;
const TICKET_PARAM = 'ticket';
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

// The browser proves who it is with its cookie. The app's socket cannot send a
// header, so it trades its Bearer token for a one-time ticket first.
async function callerFromSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return null;
  return { user: session.user, sessionHash: await sha256Hex(sessionTokenFrom(request)) };
}

async function callerFromTicket(request, env) {
  const ticket = new URL(request.url).searchParams.get(TICKET_PARAM);
  const row = await redeemAppTicket(env, ticket, SOCKET_TICKET);
  if (!row) return null;
  const user = await env.lyricalmiracle_db.prepare(
    'SELECT id, email, email_normalized, name FROM users WHERE id = ?'
  ).bind(row.user_id).first();
  return user ? { user, sessionHash: row.session_id } : null;
}

// A new request without the Cookie: the room has no use for the token.
async function roomRequest(request, { sessionHash, user }, lyricId) {
  const headers = new Headers({
    Upgrade: 'websocket',
    'X-Room-User': encodeUser(user),
    'X-Room-Session': sessionHash,
    'X-Room-Page': lyricId,
  });
  const url = new URL(request.url);
  url.searchParams.delete(TICKET_PARAM);
  return new Request(url, { headers });
}

function refuse(status, headers) {
  return new Response(null, { status, headers });
}

export async function onRequestGet({ request, env, params }) {
  if (request.headers.get('Upgrade') !== 'websocket') return refuse(HTTP_UPGRADE_REQUIRED);
  const isFromApp = isAppOrigin(request.headers.get('Origin'));
  if (!isFromApp && !isSameOrigin(request)) return refuse(HTTP_FORBIDDEN);
  const caller = isFromApp ? await callerFromTicket(request, env) : await callerFromSession(request, env);
  if (!caller) return refuse(HTTP_UNAUTHORIZED);
  const { user, sessionHash } = caller;
  const page = await openablePage(env, params.id, user);
  if (!page || !page.share_count || !isLiveFor(env, page.owner_id)) return refuse(HTTP_NOT_FOUND);
  const limit = await checkRateLimit(env, `live:connect:${user.id}`, CONNECTS_PER_MINUTE, MINUTE_MS);
  if (!limit.allowed) return refuse(HTTP_TOO_MANY_REQUESTS, { 'Retry-After': String(limit.retryAfterSeconds) });
  return roomStub(env, params.id).fetch(await roomRequest(request, caller, params.id));
}
