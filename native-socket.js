// A WebSocket look-alike for the mobile apps. A real socket cannot send an
// Authorization header, so the app first trades its token for a one-time
// ticket and only then opens the real socket. live.js needs a socket back
// straight away, so this hands one over at once and connects behind it.
(function defineNativeSocket(root) {
  'use strict';

  const STATE_CONNECTING = 0;
  const STATE_CLOSED = 3;
  const ABNORMAL_CLOSE = 1006;
  const FORWARDED_HANDLERS = Object.freeze(['onopen', 'onmessage', 'onclose', 'onerror']);

  class TicketSocket {
    // getUrl() resolves to the full socket address, ticket included.
    // openWebSocket(url) returns a real WebSocket.
    constructor({ getUrl, openWebSocket }) {
      this.binaryType = 'blob';
      this.real = null;
      this.isCancelled = false;
      this.hasFailed = false;
      FORWARDED_HANDLERS.forEach(name => { this[name] = null; });
      this.start(getUrl, openWebSocket);
    }

    get readyState() {
      if (this.real) return this.real.readyState;
      return this.isCancelled || this.hasFailed ? STATE_CLOSED : STATE_CONNECTING;
    }

    async start(getUrl, openWebSocket) {
      let url;
      try {
        url = await getUrl();
      } catch {
        this.fail();
        return;
      }
      if (this.isCancelled) return;
      this.attach(openWebSocket(url));
    }

    attach(real) {
      real.binaryType = this.binaryType;
      FORWARDED_HANDLERS.forEach(name => {
        real[name] = event => { if (this[name]) this[name](event); };
      });
      this.real = real;
    }

    // Reads like a refused upgrade, so live.js backs off and tries again.
    fail() {
      if (this.isCancelled) return;
      this.hasFailed = true;
      if (this.onclose) this.onclose({ code: ABNORMAL_CLOSE });
    }

    send(data) {
      if (!this.real) throw new Error('The socket is not open yet.');
      this.real.send(data);
    }

    close(code) {
      this.isCancelled = true;
      if (this.real) this.real.close(code);
    }
  }

  const NativeSocket = { TicketSocket };
  if (typeof module === 'object' && module.exports) {
    module.exports = NativeSocket;
    return;
  }
  root.NativeSocket = NativeSocket;
})(this);
