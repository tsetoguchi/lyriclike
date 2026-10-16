// WebSocket stand-ins wired straight to an in-process RoomCore, so browser
// sessions can be tested against the real room. Messages cross with a
// macrotask hop, as over a network.
import { RoomCore } from '../../collab/src/room-core.js';
import { FakeSocket, createRoomHost } from './fake-room-host.mjs';

const OPEN = 1;
const CLOSED = 3;
const ABNORMAL = 1006;
const NORMAL = 1000;
const PING = 'ping';
const PONG = 'pong';

const hop = fn => setImmediate(fn);

class LinkedSocket {
  constructor(link, path, identity) {
    this.link = link;
    this.readyState = 0;
    this.binaryType = 'blob';
    this.sent = [];
    this.early = [];
    this.server = new FakeSocket();
    this.server.send = bytes => this.deliver(bytes);
    this.server.close = code => this.closeFromServer(code);
    const url = new URL(path, 'https://site');
    link.host.open.push(this.server);
    link.room.join(this.server, {
      identity, sessionId: identity.sessionId,
      protocol: Number(url.searchParams.get('protocol')), epoch: url.searchParams.get('epoch'),
    }).then(() => hop(() => this.opened()));
  }

  // Like a real WebSocket: what the server sent before the open event
  // arrives right after it.
  opened() {
    if (this.readyState !== 0) return;
    this.readyState = OPEN;
    this.onopen?.();
    for (const data of this.early.splice(0)) this.onmessage?.({ data });
  }

  deliver(bytes) {
    if (this.server.closed) throw new Error('send after close');
    const data = bytes.slice().buffer;
    hop(() => {
      if (this.readyState === 0) this.early.push(data);
      else if (this.readyState === OPEN) this.onmessage?.({ data });
    });
  }

  send(data) {
    if (this.readyState !== OPEN) throw new Error('not open');
    this.sent.push(data);
    if (data === PING) {
      if (!this.link.isDeaf) hop(() => this.onmessage?.({ data: PONG }));
      return;
    }
    if (this.link.isDeaf) return;
    this.link.room.message(this.server, new Uint8Array(data));
  }

  close(code = NORMAL) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.link.room.leave(this.server);
    hop(() => this.onclose?.({ code }));
  }

  closeFromServer(code) {
    this.server.closed = { code };
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    hop(() => this.onclose?.({ code }));
  }
}

// A socket made while the network is down: it never opens and closes
// abnormally, the way a browser's does.
class RefusedSocket {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    hop(() => {
      this.readyState = CLOSED;
      this.onclose?.({ code: ABNORMAL });
    });
  }

  send() {
    throw new Error('not open');
  }

  close() {
    this.readyState = CLOSED;
  }
}

export function createRoomLink({ db, lyricId }) {
  const host = createRoomHost({ db, lyricId });
  const link = { host, room: new RoomCore(host), sockets: [], isDeaf: false, offline: new Set() };
  link.connect = (path, identity) => {
    if (link.offline.has(identity.userId)) return new RefusedSocket();
    const socket = new LinkedSocket(link, path, identity);
    link.sockets.push(socket);
    return socket;
  };
  // The network goes away under a socket: the room sees it leave, the client
  // hears an abnormal close.
  link.drop = socket => {
    socket.readyState = CLOSED;
    socket.server.closed = { code: ABNORMAL };
    link.room.leave(socket.server);
    hop(() => socket.onclose?.({ code: ABNORMAL }));
  };
  return link;
}
