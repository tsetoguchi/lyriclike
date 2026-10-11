// SPIKE ONLY (branch live-spike): an echo room that answers the questions in
// plans/live-co-editing.md §3.2. Not for merging.
import { DurableObject } from 'cloudflare:workers';

const HTTP_NOT_FOUND = 404;
const HTTP_UPGRADE_REQUIRED = 426;
const SWITCHING_PROTOCOLS = 101;
const PING = 'ping';
const PONG = 'pong';

// The room has no public door; only the Pages binding reaches PageRoom.
export default {
  fetch() {
    return new Response(null, { status: HTTP_NOT_FOUND });
  },
};

function decodeUser(header) {
  try {
    return JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(header || ''), c => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

function byteLength(message) {
  return typeof message === 'string'
    ? new TextEncoder().encode(message).length
    : message.byteLength;
}

export class PageRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answered by the platform without waking the room or billing a request.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER)');
    this.wakes = this.bumpStat('wakes');
    this.awakeSince = Date.now();
    this.messagesSinceWake = 0;
    this.bytesSinceWake = 0;
  }

  bumpStat(key) {
    return this.ctx.storage.sql.exec(
      `INSERT INTO stats (key, value) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value`, key).one().value;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(null, { status: HTTP_UPGRADE_REQUIRED });
    }
    const user = decodeUser(request.headers.get('X-Room-User'));
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ user, joinedAt: Date.now() });
    server.send(JSON.stringify({
      type: 'hello',
      user,
      session: request.headers.get('X-Room-Session') ? 'present' : 'missing',
      cookieReachedRoom: request.headers.has('Cookie'),
      sockets: this.ctx.getWebSockets().length,
      wakes: this.wakes,
    }));
    return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
  }

  webSocketMessage(ws, message) {
    this.messagesSinceWake += 1;
    this.bytesSinceWake += byteLength(message);
    if (typeof message !== 'string') {
      ws.send(JSON.stringify({ type: 'size', bytes: message.byteLength }));
      return;
    }
    const parsed = this.parse(message);
    if (parsed?.type === 'stats') {
      ws.send(JSON.stringify(this.stats()));
      return;
    }
    if (parsed?.type === 'echo') {
      this.relay(ws, message);
      return;
    }
    ws.send(JSON.stringify({ type: 'size', bytes: byteLength(message) }));
  }

  parse(message) {
    if (message.length > 10_000) return null;
    try {
      return JSON.parse(message);
    } catch {
      return null;
    }
  }

  relay(sender, message) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== sender) socket.send(message);
    }
  }

  stats() {
    return {
      type: 'stats',
      wakes: this.wakes,
      awakeForMs: Date.now() - this.awakeSince,
      messagesSinceWake: this.messagesSinceWake,
      bytesSinceWake: this.bytesSinceWake,
      sockets: this.ctx.getWebSockets().length,
    };
  }

  // 1005 and 1006 cannot be sent back, so those close with a plain 1000.
  webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      ws.close(1000);
    }
  }
}
