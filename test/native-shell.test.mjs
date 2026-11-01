// native-shell.js and native-socket.js: what the mobile apps add on top of the
// bundled pages. Plugins and the network are stood in for; nothing here needs
// a device.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const shell = require('../native-shell.js');
const { TicketSocket } = require('../native-socket.js');

const IOS_PAGE = new URL('capacitor://localhost/index.html');
const ANDROID_PAGE = new URL('https://localhost/index.html');
const API_ORIGIN = 'https://lyriclike.com';
const TOKEN_KEY = 'session_token';
const VERIFIER_KEY = 'google_sign_in_verifier';
const HEX_64 = /^[0-9a-f]{64}$/;
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
const ABNORMAL_CLOSE = 1006;

function fakePreferences(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async ({ key }) => ({ value: values.has(key) ? values.get(key) : null }),
    set: async ({ key, value }) => { values.set(key, value); },
    remove: async ({ key }) => { values.delete(key); },
  };
}

function fakeNetwork(answer = () => Response.json({})) {
  const calls = [];
  const nativeFetch = async request => {
    calls.push(request);
    return answer(request);
  };
  return { calls, nativeFetch };
}

async function makeApi({ page = IOS_PAGE, stored = {}, answer } = {}) {
  const preferences = fakePreferences(stored);
  const tokenStore = shell.createTokenStore(preferences);
  const network = fakeNetwork(answer);
  const apiFetch = shell.createApiFetch({ nativeFetch: network.nativeFetch, tokenStore, pageUrl: page });
  await tokenStore.ready;
  return { preferences, tokenStore, network, apiFetch };
}

describe('toApiUrl', () => {
  for (const page of [IOS_PAGE, ANDROID_PAGE]) {
    it(`sends an /api path to the real site from ${page.protocol}`, () => {
      assert.equal(shell.toApiUrl('/api/me', page), `${API_ORIGIN}/api/me`);
      assert.equal(shell.toApiUrl('/api/lyrics?x=1', page), `${API_ORIGIN}/api/lyrics?x=1`);
      assert.equal(shell.toApiUrl(new URL('/api/me', page), page), `${API_ORIGIN}/api/me`);
    });
  }

  it('leaves bundled files and other sites alone', () => {
    assert.equal(shell.toApiUrl('/cmudict.json?v=1', IOS_PAGE), null);
    assert.equal(shell.toApiUrl('https://example.com/api/me', IOS_PAGE), null);
    assert.equal(shell.toApiUrl('', IOS_PAGE), null);
  });
});

describe('externalTargetFor', () => {
  for (const page of [IOS_PAGE, ANDROID_PAGE]) {
    it(`opens pages that are not in the app on the real site from ${page.protocol}`, () => {
      assert.equal(shell.externalTargetFor('/guide/', page), `${API_ORIGIN}/guide/`);
      assert.equal(shell.externalTargetFor('/rhymes/love/?a=1#b', page), `${API_ORIGIN}/rhymes/love/?a=1#b`);
      assert.equal(shell.externalTargetFor('/privacy/', page), `${API_ORIGIN}/privacy/`);
      assert.equal(shell.externalTargetFor('/terms/', page), `${API_ORIGIN}/terms/`);
      assert.equal(shell.externalTargetFor('/anything-else', page), `${API_ORIGIN}/anything-else`);
    });

    it(`keeps the app's own pages inside the app from ${page.protocol}`, () => {
      assert.equal(shell.externalTargetFor('/', page), null);
      assert.equal(shell.externalTargetFor('/index.html#shared=1', page), null);
    });
  }

  it('sends links to other sites to the system browser, but not mail or phone links', () => {
    assert.equal(shell.externalTargetFor('https://example.com/a', IOS_PAGE), 'https://example.com/a');
    assert.equal(shell.externalTargetFor('mailto:a@b.co', IOS_PAGE), null);
    assert.equal(shell.externalTargetFor('tel:+15551234', IOS_PAGE), null);
  });
});

describe('token store', () => {
  it('loads a saved token, and saves and clears it', async () => {
    const preferences = fakePreferences({ [TOKEN_KEY]: 'saved' });
    const store = shell.createTokenStore(preferences);
    await store.ready;
    assert.equal(store.get(), 'saved');
    await store.set('new');
    assert.equal(preferences.values.get(TOKEN_KEY), 'new');
    await store.clear();
    assert.equal(store.get(), null);
    assert.equal(preferences.values.has(TOKEN_KEY), false);
  });

  it('still becomes ready when storage fails', async () => {
    const broken = { get: async () => { throw new Error('no storage'); } };
    const store = shell.createTokenStore(broken);
    await store.ready;
    assert.equal(store.get(), null);
  });
});

describe('the fetch wrapper', () => {
  it('moves an /api call to the real site with the Bearer token and the app marker', async () => {
    const { apiFetch, network } = await makeApi({ stored: { [TOKEN_KEY]: 'tok' } });
    await apiFetch('/api/me');
    const [request] = network.calls;
    assert.equal(request.url, `${API_ORIGIN}/api/me`);
    assert.equal(request.headers.get('Authorization'), 'Bearer tok');
    assert.equal(request.headers.get('X-LyricLike-Client'), 'app');
  });

  it('keeps the method, body and headers the page asked for', async () => {
    const { apiFetch, network } = await makeApi({ stored: { [TOKEN_KEY]: 'tok' } });
    await apiFetch('/api/lyrics/x', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}',
    });
    const [request] = network.calls;
    assert.equal(request.method, 'PUT');
    assert.equal(request.headers.get('Content-Type'), 'application/json');
    assert.equal(await request.text(), '{"a":1}');
  });

  it('sends no Authorization header before sign-in', async () => {
    const { apiFetch, network } = await makeApi();
    await apiFetch('/api/me');
    assert.equal(network.calls[0].headers.get('Authorization'), null);
  });

  it('passes anything else through untouched', async () => {
    const { apiFetch, network } = await makeApi();
    await apiFetch('/cmudict.json');
    assert.equal(network.calls[0], '/cmudict.json');
  });

  it('keeps the token a sign-in answers with', async () => {
    const { apiFetch, preferences } = await makeApi({
      answer: () => Response.json({ user: {}, token: 'fresh' }),
    });
    await apiFetch('/api/auth/login', { method: 'POST', body: '{}' });
    assert.equal(preferences.values.get(TOKEN_KEY), 'fresh');
  });

  it('hands the page the same body it would have had', async () => {
    const { apiFetch } = await makeApi({ answer: () => Response.json({ user: 1, token: 'fresh' }) });
    const response = await apiFetch('/api/auth/login', { method: 'POST', body: '{}' });
    assert.deepEqual(await response.json(), { user: 1, token: 'fresh' });
  });

  it('drops the token on sign-out and on account deletion', async () => {
    for (const [path, method] of [['/api/auth/logout', 'POST'], ['/api/account', 'DELETE']]) {
      const { apiFetch, preferences } = await makeApi({
        stored: { [TOKEN_KEY]: 'tok' }, answer: () => new Response(null, { status: 200 }),
      });
      await apiFetch(path, { method });
      assert.equal(preferences.values.has(TOKEN_KEY), false, path);
    }
  });

  it('drops the token when the server says the session is gone', async () => {
    const { apiFetch, preferences } = await makeApi({
      stored: { [TOKEN_KEY]: 'tok' }, answer: () => new Response(null, { status: 401 }),
    });
    await apiFetch('/api/me');
    assert.equal(preferences.values.has(TOKEN_KEY), false);
  });

  it('keeps the token when another route answers 401', async () => {
    for (const path of ['/api/invites/mine', '/api/define/word', '/api/lyrics']) {
      const { apiFetch, preferences } = await makeApi({
        stored: { [TOKEN_KEY]: 'tok' }, answer: () => new Response(null, { status: 401 }),
      });
      await apiFetch(path);
      assert.equal(preferences.values.get(TOKEN_KEY), 'tok', path);
    }
  });

  it('keeps the token when a sign-in attempt is refused', async () => {
    const { apiFetch, preferences } = await makeApi({
      stored: { [TOKEN_KEY]: 'tok' }, answer: () => new Response(null, { status: 401 }),
    });
    await apiFetch('/api/auth/login', { method: 'POST', body: '{}' });
    assert.equal(preferences.values.get(TOKEN_KEY), 'tok');
  });
});

describe('Google sign-in', () => {
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  let reloads;
  let failures;
  let browser;

  beforeEach(() => {
    reloads = 0;
    failures = 0;
    browser = {
      opened: [],
      closed: 0,
      open: async options => { browser.opened.push(options.url); },
      close: async () => { browser.closed += 1; },
    };
    Object.defineProperty(globalThis, 'location', {
      value: { reload: () => { reloads += 1; } }, configurable: true,
    });
    globalThis.document = { dispatchEvent: event => { if (event.type === 'native-sign-in-failed') failures += 1; } };
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true });
    globalThis.document = originalDocument;
  });

  async function begin(api) {
    await shell.startGoogleSignIn({ preferences: api.preferences, browser });
    const verifier = api.preferences.values.get(VERIFIER_KEY);
    return { verifier, url: new URL(browser.opened[0]) };
  }

  it('opens the system browser with the hash of a secret it keeps', async () => {
    const api = await makeApi();
    const { verifier, url } = await begin(api);
    const expected = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
      .toString('hex');
    assert.equal(url.origin + url.pathname, `${API_ORIGIN}/api/auth/google/start`);
    assert.equal(url.searchParams.get('client'), 'app');
    assert.equal(url.searchParams.get('challenge'), expected);
    assert.match(verifier, HEX_64);
    assert.notEqual(url.searchParams.get('challenge'), verifier);
  });

  it('ignores addresses that are not the sign-in coming back', async () => {
    const api = await makeApi();
    const context = { ...api, browser };
    assert.equal(await shell.finishGoogleSignIn('lyriclike://other', context), false);
    assert.equal(await shell.finishGoogleSignIn('https://example.com/', context), false);
    assert.equal(reloads, 0);
  });

  it('trades the code and the secret for a token, then reloads signed in', async () => {
    const api = await makeApi({ answer: () => Response.json({ user: {}, token: 'fresh' }) });
    const { verifier } = await begin(api);
    const handled = await shell.finishGoogleSignIn('lyriclike://auth?code=abc', { ...api, browser });

    assert.equal(handled, true);
    const [request] = api.network.calls;
    assert.equal(request.url, `${API_ORIGIN}/api/auth/app-exchange`);
    assert.deepEqual(await request.json(), { code: 'abc', verifier });
    assert.equal(api.preferences.values.get(TOKEN_KEY), 'fresh');
    assert.equal(api.preferences.values.has(VERIFIER_KEY), false);
    assert.equal(browser.closed, 1);
    assert.equal(reloads, 1);
  });

  it('tells the person when the exchange is refused', async () => {
    const api = await makeApi({ answer: () => new Response(null, { status: 401 }) });
    await begin(api);
    await shell.finishGoogleSignIn('lyriclike://auth?code=abc', { ...api, browser });
    assert.equal(reloads, 0);
    assert.equal(failures, 1);
    assert.equal(api.preferences.values.has(TOKEN_KEY), false);
  });

  it('tells the person when it has no secret to answer with', async () => {
    const api = await makeApi();
    await shell.finishGoogleSignIn('lyriclike://auth?code=abc', { ...api, browser });
    assert.equal(api.network.calls.length, 0);
    assert.equal(failures, 1);
  });
});

describe('Apple sign-in', () => {
  const originalLocation = globalThis.location;
  const originalDocument = globalThis.document;
  const SHEET = {
    response: {
      user: 'apple-user', email: null, givenName: 'Ann', familyName: 'Lee',
      identityToken: 'identity.token.here', authorizationCode: 'one-time-code',
    },
  };
  let reloads;
  let failures;
  let authorizeCalls;

  beforeEach(() => {
    reloads = 0;
    failures = 0;
    authorizeCalls = [];
    Object.defineProperty(globalThis, 'location', {
      value: { reload: () => { reloads += 1; } }, configurable: true,
    });
    globalThis.document = {
      dispatchEvent: event => { if (event.type === 'native-sign-in-failed') failures += 1; },
    };
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true });
    globalThis.document = originalDocument;
  });

  function fakeSheet(answer) {
    return {
      authorize: async options => {
        authorizeCalls.push(options);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Buffer.from(digest).toString('hex');
  }

  it('asks Apple for the hash of a nonce, and tells the server the nonce itself', async () => {
    const api = await makeApi({ answer: () => Response.json({ user: {}, token: 'fresh' }) });
    await shell.startAppleSignIn({ appleSignIn: fakeSheet(SHEET), apiFetch: api.apiFetch });

    const [options] = authorizeCalls;
    assert.equal(options.scopes, 'email name');
    const [request] = api.network.calls;
    const body = await request.json();
    assert.match(body.nonce, HEX_64);
    assert.equal(options.nonce, await sha256(body.nonce));
    assert.notEqual(options.nonce, body.nonce);
  });

  it('sends the token, the code and the name to the server, and keeps the session', async () => {
    const api = await makeApi({ answer: () => Response.json({ user: {}, token: 'fresh' }) });
    await shell.startAppleSignIn({ appleSignIn: fakeSheet(SHEET), apiFetch: api.apiFetch });

    const [request] = api.network.calls;
    assert.equal(request.url, `${API_ORIGIN}/api/auth/apple`);
    assert.equal(request.method, 'POST');
    const body = await request.json();
    assert.equal(body.identityToken, 'identity.token.here');
    assert.equal(body.authorizationCode, 'one-time-code');
    assert.equal(body.givenName, 'Ann');
    assert.equal(body.familyName, 'Lee');
    assert.equal(api.preferences.values.get(TOKEN_KEY), 'fresh');
    assert.equal(reloads, 1);
    assert.equal(failures, 0);
  });

  it('uses a new nonce each time', async () => {
    const api = await makeApi({ answer: () => Response.json({ user: {}, token: 'fresh' }) });
    const context = { appleSignIn: fakeSheet(SHEET), apiFetch: api.apiFetch };
    await shell.startAppleSignIn(context);
    await shell.startAppleSignIn(context);
    const [first, second] = await Promise.all(api.network.calls.map(call => call.json()));
    assert.notEqual(first.nonce, second.nonce);
  });

  it('says nothing and sends nothing when the person closes the sheet', async () => {
    const api = await makeApi();
    const closed = Object.assign(new Error('The operation could not be completed.'), { code: '1001' });
    await shell.startAppleSignIn({ appleSignIn: fakeSheet(closed), apiFetch: api.apiFetch });

    assert.equal(api.network.calls.length, 0);
    assert.equal(failures, 0);
    assert.equal(reloads, 0);
  });

  it('says so when the sheet fails for any other reason', async () => {
    const api = await makeApi();
    const broken = Object.assign(new Error('Sign in with Apple is not set up.'), { code: '1000' });
    await shell.startAppleSignIn({ appleSignIn: fakeSheet(broken), apiFetch: api.apiFetch });

    assert.equal(api.network.calls.length, 0);
    assert.equal(failures, 1);
  });

  it('says so, and keeps no session, when the server turns the sign-in away', async () => {
    const api = await makeApi({ answer: () => new Response(null, { status: 401 }) });
    await shell.startAppleSignIn({ appleSignIn: fakeSheet(SHEET), apiFetch: api.apiFetch });

    assert.equal(failures, 1);
    assert.equal(reloads, 0);
    assert.equal(api.preferences.values.has(TOKEN_KEY), false);
  });
});

describe('TicketSocket', () => {
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = CONNECTING;
      this.sent = [];
      this.closedWith = null;
    }

    send(data) { this.sent.push(data); }
    close(code) { this.closedWith = code; this.readyState = CLOSED; }
  }

  function make(getUrl) {
    const opened = [];
    const socket = new TicketSocket({
      getUrl,
      openWebSocket: url => {
        const real = new FakeWebSocket(url);
        opened.push(real);
        return real;
      },
    });
    return { socket, opened };
  }

  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  it('reads as connecting until the address is ready, then follows the real socket', async () => {
    const { socket, opened } = make(async () => 'wss://x/live?ticket=t');
    assert.equal(socket.readyState, CONNECTING);
    await tick();
    assert.equal(opened[0].url, 'wss://x/live?ticket=t');
    opened[0].readyState = OPEN;
    assert.equal(socket.readyState, OPEN);
  });

  it('passes binaryType, handlers and sends through to the real socket', async () => {
    const { socket, opened } = make(async () => 'wss://x');
    const events = [];
    socket.binaryType = 'arraybuffer';
    socket.onopen = event => events.push(['open', event]);
    socket.onmessage = event => events.push(['message', event.data]);
    socket.onclose = event => events.push(['close', event.code]);
    await tick();

    const [real] = opened;
    assert.equal(real.binaryType, 'arraybuffer');
    real.onopen('o');
    real.onmessage({ data: 'hi' });
    real.onclose({ code: 1000 });
    socket.send('out');
    assert.deepEqual(events, [['open', 'o'], ['message', 'hi'], ['close', 1000]]);
    assert.deepEqual(real.sent, ['out']);
  });

  it('refuses to send before it is open', () => {
    const { socket } = make(() => new Promise(() => {}));
    assert.throws(() => socket.send('x'));
  });

  it('never opens a real socket if it was closed first', async () => {
    const { socket, opened } = make(async () => 'wss://x');
    socket.close(1000);
    await tick();
    assert.equal(opened.length, 0);
    assert.equal(socket.readyState, CLOSED);
  });

  it('closes the real socket with the code it was given', async () => {
    const { socket, opened } = make(async () => 'wss://x');
    await tick();
    socket.close(1000);
    assert.equal(opened[0].closedWith, 1000);
  });

  it('reports an abnormal close when the ticket cannot be had', async () => {
    const { socket, opened } = make(async () => { throw new Error('no ticket'); });
    const codes = [];
    socket.onclose = event => codes.push(event.code);
    await tick();
    assert.deepEqual(codes, [ABNORMAL_CLOSE]);
    assert.equal(socket.readyState, CLOSED);
    assert.equal(opened.length, 0);
  });
});

describe('openLiveSocket', () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));

  it('asks for a ticket for that page and opens the real socket with it', async () => {
    const api = await makeApi({
      stored: { [TOKEN_KEY]: 'tok' }, answer: () => Response.json({ ticket: 'a b' }),
    });
    const urls = [];
    class FakeWebSocket { constructor(url) { urls.push(url); } }
    shell.openLiveSocket('/api/lyrics/p%201/live?protocol=1&epoch=e', {
      apiFetch: api.apiFetch, WebSocketImpl: FakeWebSocket, TicketSocket,
    });
    await tick();

    const [request] = api.network.calls;
    assert.equal(request.url, `${API_ORIGIN}/api/lyrics/p%201/live-ticket`);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('Authorization'), 'Bearer tok');
    assert.deepEqual(urls, ['wss://lyriclike.com/api/lyrics/p%201/live?protocol=1&epoch=e&ticket=a%20b']);
  });

  it('closes abnormally when the ticket is refused', async () => {
    const api = await makeApi({ answer: () => new Response(null, { status: 401 }) });
    const socket = shell.openLiveSocket('/api/lyrics/p/live?protocol=1', {
      apiFetch: api.apiFetch, WebSocketImpl: class {}, TicketSocket,
    });
    const codes = [];
    socket.onclose = event => codes.push(event.code);
    await tick();
    assert.deepEqual(codes, [ABNORMAL_CLOSE]);
  });
});
