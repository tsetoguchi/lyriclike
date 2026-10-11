// SPIKE ONLY (branch live-spike): hands a WebSocket upgrade to the page's
// room. Answers spike item 1 in plans/live-co-editing.md §3.2.
import { getSession, parseCookies, sha256Hex } from '../../../_shared.js';
import { CAN_OPEN, canOpenParams } from '../../../_shares.js';

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UPGRADE_REQUIRED = 426;
const SESSION_COOKIE = 'sid';

function encodeUser(user) {
  const json = JSON.stringify({ id: user.id, name: user.name, email: user.email });
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)));
}

// The middleware's forgery check skips GETs, and an upgrade is a GET.
function isSameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

async function canOpen(env, id, user) {
  const row = await env.lyricalmiracle_db.prepare(
    `SELECT id FROM lyrics WHERE id = ? AND ${CAN_OPEN}`
  ).bind(id, ...canOpenParams(user)).first();
  return Boolean(row);
}

// A new request without the Cookie: the room has no use for the token.
async function roomRequest(request, user) {
  const headers = new Headers({
    Upgrade: 'websocket',
    'X-Room-User': encodeUser(user),
    'X-Room-Session': await sha256Hex(parseCookies(request)[SESSION_COOKIE]),
  });
  return new Request(request.url, { headers });
}

// What the Function sees on a plain GET, so a phone can show it.
async function probe(request, env, id) {
  const session = await getSession(request, env);
  return Response.json({
    cookieSent: Boolean(parseCookies(request)[SESSION_COOKIE]),
    signedIn: Boolean(session),
    canOpen: session ? await canOpen(env, id, session.user) : false,
  });
}

export async function onRequestGet({ request, env, params }) {
  console.log('live request', JSON.stringify({
    upgrade: request.headers.get('Upgrade'),
    origin: request.headers.get('Origin'),
    host: new URL(request.url).host,
    cookieSent: Boolean(parseCookies(request)[SESSION_COOKIE]),
    ua: request.headers.get('User-Agent'),
  }));
  if (request.headers.get('Upgrade') !== 'websocket') {
    if (new URL(request.url).searchParams.has('probe')) return probe(request, env, params.id);
    return new Response(null, { status: HTTP_UPGRADE_REQUIRED });
  }
  if (!isSameOrigin(request)) {
    console.log('live refused: origin');
    return new Response(null, { status: HTTP_FORBIDDEN });
  }
  const session = await getSession(request, env);
  if (!session) {
    console.log('live refused: no session');
    return new Response(null, { status: 401 });
  }
  if (!await canOpen(env, params.id, session.user)) {
    return new Response(null, { status: HTTP_NOT_FOUND });
  }
  const stub = env.PAGE_ROOM.get(env.PAGE_ROOM.idFromName(params.id));
  return stub.fetch(await roomRequest(request, session.user));
}
