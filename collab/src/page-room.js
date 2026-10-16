// The Durable Object around RoomCore: it turns the platform's sockets,
// storage, alarm and requests into RoomCore's host and calls.
import { DurableObject } from 'cloudflare:workers';

import { DiffMatchPatch } from './deps.js';
import { colourFor } from './presence.js';
import { RoomCore } from './room-core.js';
import { readEvictEmail } from './room-requests.js';
import { RoomStorage } from './room-storage.js';

const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UPGRADE_REQUIRED = 426;
const SWITCHING_PROTOCOLS = 101;
// Keepalives are answered by the platform without waking the room.
const PING = 'ping';
const PONG = 'pong';

function decodeUser(header) {
  try {
    const bytes = Uint8Array.from(atob(header || ''), char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function identityOf(user) {
  return { userId: user.id, email: user.email, name: user.name || user.email, colour: colourFor(user.id) };
}

export class PageRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    this.storage = new RoomStorage(ctx.storage);
    this.core = new RoomCore({
      db: env.lyricalmiracle_db,
      storage: this.storage,
      dmp: new DiffMatchPatch(),
      lyricId: async () => this.storage.loadPageId(),
      sockets: () => ctx.getWebSockets(),
      now: () => Date.now(),
      getAlarm: () => ctx.storage.getAlarm(),
      setAlarm: at => ctx.storage.setAlarm(at),
      deleteAlarm: () => ctx.storage.deleteAlarm(),
      log: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pageId = request.headers.get('X-Room-Page');
    if (pageId && !this.storage.loadPageId()) this.storage.savePageId(pageId);
    if (url.pathname === '/evict') {
      await this.core.evict(await readEvictEmail(request));
      return new Response(null, { status: HTTP_NO_CONTENT });
    }
    if (url.pathname === '/close') {
      await this.core.closeRoom();
      return new Response(null, { status: HTTP_NO_CONTENT });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response(null, { status: HTTP_UPGRADE_REQUIRED });
    return this.accept(request, url);
  }

  async accept(request, url) {
    const user = decodeUser(request.headers.get('X-Room-User'));
    if (!user) return new Response(null, { status: HTTP_BAD_REQUEST });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    await this.core.join(server, {
      identity: identityOf(user),
      sessionId: request.headers.get('X-Room-Session'),
      protocol: Number(url.searchParams.get('protocol')),
      epoch: url.searchParams.get('epoch'),
    });
    return new Response(null, { status: SWITCHING_PROTOCOLS, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message === 'string') return;
    await this.core.message(ws, new Uint8Array(message));
  }

  async webSocketClose(ws) {
    await this.core.leave(ws);
  }

  async webSocketError(ws) {
    await this.core.leave(ws);
  }

  async alarm() {
    await this.core.alarm();
  }
}
