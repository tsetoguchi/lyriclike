// POST /api/lyrics/:id/live-ticket — the app's way into the live-editing
// socket. A WebSocket cannot carry an Authorization header, so the app trades
// its Bearer token for a ticket that works once, for a minute, on the socket.
// Whether the person may open the page is checked when the socket connects.
import { SOCKET_TICKET, issueAppTicket } from '../../../_app-tickets.js';
import { hasBearerToken, requireUser, sessionTokenFrom, sha256Hex } from '../../../_shared.js';

const HTTP_BAD_REQUEST = 400;

export async function onRequestPost({ request, env }) {
  if (!hasBearerToken(request)) return new Response(null, { status: HTTP_BAD_REQUEST });
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const ticket = await issueAppTicket(env, {
    kind: SOCKET_TICKET,
    userId: user.id,
    sessionId: await sha256Hex(sessionTokenFrom(request)),
  });
  return Response.json({ ticket });
}
