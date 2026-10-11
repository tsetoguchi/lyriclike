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

  opened() {
    if (this.readyState !== 0) return;
    this.readyState = OPEN;
    this.onopen?.();
  }

  deliver(bytes) {
    if (this.server.closed) throw new Error('send after close');
    const copy = bytes.slice();
    hop(() => { if (this.readyState === OPEN) this.onmessage?.({ data: copy.buffer }); });
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

export function createRoomLink({ db, lyricId }) {
  const host = createRoomHost({ db, lyricId });
  const link = { host, room: new RoomCore(host), sockets: [], isDeaf: false };
  link.connect = (path, identity) => {
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
