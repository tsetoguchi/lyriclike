// What the iOS and Android apps need that the website does not. The pages are
// bundled and load from capacitor://localhost (iOS) or https://localhost
// (Android), so /api calls have to go to the real site and carry a Bearer
// token, Google sign-in has to run in the system browser, and the live socket
// needs a ticket. On the website this file does nothing.
(function defineNativeShell(root) {
  'use strict';

  const API_ORIGIN = 'https://lyriclike.com';
  const SOCKET_ORIGIN = 'wss://lyriclike.com';
  const API_PREFIX = '/api/';
  const AUTH_PREFIX = '/api/auth/';
  const SIGN_IN_PATH = '/api/auth/google/start';
  const EXCHANGE_PATH = '/api/auth/app-exchange';
  const LOGOUT_PATH = '/api/auth/logout';
  const ACCOUNT_PATH = '/api/account';
  const SESSION_CHECK_PATH = '/api/me';
  const TOKEN_KEY = 'session_token';
  const VERIFIER_KEY = 'google_sign_in_verifier';
  const CLIENT_HEADER = 'X-LyricLike-Client';
  const CLIENT_VALUE = 'app';
  const RETURN_URL_PREFIX = 'lyriclike://auth';
  const VERIFIER_BYTES = 32;
  const HTTP_UNAUTHORIZED = 401;
  const SIGN_IN_FAILED_EVENT = 'native-sign-in-failed';
  const APPLE_SIGN_IN_PATH = '/api/auth/apple';
  // The system's code for a person closing the Apple sheet.
  const APPLE_CANCELLED_CODE = '1001';
  const APPLE_SCOPES = 'email name';
  const LIVE_PATH_PATTERN = /^\/api\/lyrics\/([^/?]+)\/live\?/;
  // The only pages in the bundle. Any other page of the site (the guide, the
  // rhyme pages, the legal pages) lives on the real site and opens there.
  const APP_PAGE_PATHS = Object.freeze(['/', '/index.html']);
  const WEB_PROTOCOLS = Object.freeze(['http:', 'https:']);

  function isSameSite(url, pageUrl) {
    return url.protocol === pageUrl.protocol && url.host === pageUrl.host;
  }

  // The real address for an /api call, or null for anything else.
  function toApiUrl(input, pageUrl) {
    const raw = typeof input === 'string' ? input : (input && (input.href || input.url));
    if (!raw) return null;
    const url = new URL(raw, pageUrl);
    if (!isSameSite(url, pageUrl) || !url.pathname.startsWith(API_PREFIX)) return null;
    return API_ORIGIN + url.pathname + url.search;
  }

  // Where a link should open in the system browser instead of in the app, or
  // null to let the app follow it.
  function externalTargetFor(href, pageUrl) {
    const url = new URL(href, pageUrl);
    if (isSameSite(url, pageUrl)) {
      const isAppPage = APP_PAGE_PATHS.includes(url.pathname);
      return isAppPage ? null : API_ORIGIN + url.pathname + url.search + url.hash;
    }
    return WEB_PROTOCOLS.includes(url.protocol) ? url.href : null;
  }

  function hexOf(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(text) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return hexOf(new Uint8Array(digest));
  }

  // Preferences survives the system clearing the webview's storage, which
  // localStorage does not. `ready` never rejects, so a failed read only means
  // the person signs in again.
  function createTokenStore(preferences) {
    let token = null;
    const ready = preferences.get({ key: TOKEN_KEY })
      .then(result => { token = result.value || null; })
      .catch(() => {});
    return {
      ready,
      get: () => token,
      set(value) {
        token = value;
        return preferences.set({ key: TOKEN_KEY, value });
      },
      clear() {
        token = null;
        return preferences.remove({ key: TOKEN_KEY });
      },
    };
  }

  function isSignOut(path, method) {
    return (path === LOGOUT_PATH && method === 'POST')
      || (path === ACCOUNT_PATH && method === 'DELETE');
  }

  // Keeps the token a sign-in answers with, and drops it when the session is
  // over, whether the person ended it or the server did. Only the account
  // check can say the session is gone: another route answering 401 may just
  // not understand the token yet (a server deployed in two parts), and
  // throwing the token away for that signs the person out for good.
  async function rememberSession(response, { path, method, hadToken }, tokenStore) {
    if (response.status === HTTP_UNAUTHORIZED && hadToken && path === SESSION_CHECK_PATH) {
      await tokenStore.clear();
      return;
    }
    if (!response.ok) return;
    if (isSignOut(path, method)) {
      await tokenStore.clear();
      return;
    }
    if (!path.startsWith(AUTH_PREFIX)) return;
    const body = await response.clone().json().catch(() => null);
    if (body && typeof body.token === 'string') await tokenStore.set(body.token);
  }

  function createApiFetch({ nativeFetch, tokenStore, pageUrl }) {
    return async function apiFetch(input, init) {
      const target = toApiUrl(input, pageUrl);
      if (!target) return nativeFetch(input, init);

      await tokenStore.ready;
      const token = tokenStore.get();
      const request = new Request(target, input instanceof Request ? input : init);
      request.headers.set(CLIENT_HEADER, CLIENT_VALUE);
      if (token && !request.headers.has('Authorization')) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      const response = await nativeFetch(request);
      const details = { path: new URL(target).pathname, method: request.method, hadToken: Boolean(token) };
      await rememberSession(response, details, tokenStore);
      return response;
    };
  }

  function openLinksInSystemBrowser({ document, pageUrl, browser }) {
    document.addEventListener('click', event => {
      const anchor = event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const target = externalTargetFor(anchor.href, pageUrl);
      if (!target) return;
      event.preventDefault();
      browser.open({ url: target });
    });
  }

  function randomVerifier() {
    return hexOf(globalThis.crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
  }

  function failSignIn() {
    globalThis.document.dispatchEvent(new globalThis.CustomEvent(SIGN_IN_FAILED_EVENT));
  }

  // The hash goes to the server now; the secret stays here until the app is
  // handed the code, so only this app can finish the sign-in it started.
  async function startGoogleSignIn({ preferences, browser }) {
    const verifier = randomVerifier();
    await preferences.set({ key: VERIFIER_KEY, value: verifier });
    const challenge = await sha256Hex(verifier);
    await browser.open({ url: `${API_ORIGIN}${SIGN_IN_PATH}?client=app&challenge=${challenge}` });
  }

  function exchangeRequestFor(code, verifier) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    };
  }

  // Returns true when the address was the sign-in coming back. apiFetch keeps
  // the token the exchange answers with.
  async function finishGoogleSignIn(url, { preferences, browser, apiFetch }) {
    if (!url.startsWith(RETURN_URL_PREFIX)) return false;
    const code = new URL(url).searchParams.get('code');
    const { value: verifier } = await preferences.get({ key: VERIFIER_KEY });
    await preferences.remove({ key: VERIFIER_KEY });
    await browser.close().catch(() => {});

    // A network failure must end like a refusal, not as an unhandled rejection.
    const response = code && verifier
      ? await apiFetch(EXCHANGE_PATH, exchangeRequestFor(code, verifier)).catch(() => null)
      : null;
    if (response && response.ok) {
      globalThis.location.reload();
      return true;
    }
    // auth.js, which loads after this file, words the notice.
    failSignIn();
    return true;
  }

  // Asks the system for Apple's identity token. The nonce is made here: Apple
  // gets its hash, the server gets the original, and a token made for another
  // sign-in will not match. Returns the sheet's fields, or null if the person
  // closed it or it failed (a failure says so through the sign-in event).
  async function askApple(appleSignIn, rawNonce) {
    try {
      const result = await appleSignIn.authorize({
        scopes: APPLE_SCOPES, nonce: await sha256Hex(rawNonce),
      });
      return result.response;
    } catch (error) {
      if (!error || String(error.code) !== APPLE_CANCELLED_CODE) failSignIn();
      return null;
    }
  }

  function appleSignInRequest(fields, rawNonce) {
    const { identityToken, authorizationCode, givenName, familyName } = fields;
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identityToken, authorizationCode, nonce: rawNonce, givenName, familyName,
      }),
    };
  }

  // apiFetch keeps the session token the server answers with, so the page only
  // has to start again signed in.
  async function startAppleSignIn({ appleSignIn, apiFetch }) {
    const rawNonce = randomVerifier();
    const fields = await askApple(appleSignIn, rawNonce);
    if (!fields) return;
    const response = await apiFetch(APPLE_SIGN_IN_PATH, appleSignInRequest(fields, rawNonce));
    if (response.ok) globalThis.location.reload();
    else failSignIn();
  }

  function openLiveSocket(path, { apiFetch, WebSocketImpl, TicketSocket }) {
    const match = LIVE_PATH_PATTERN.exec(path);
    return new TicketSocket({
      async getUrl() {
        const response = await apiFetch(`/api/lyrics/${match[1]}/live-ticket`, { method: 'POST' });
        if (!response.ok) throw new Error('No live ticket.');
        const { ticket } = await response.json();
        return `${SOCKET_ORIGIN}${path}&ticket=${encodeURIComponent(ticket)}`;
      },
      openWebSocket: url => new WebSocketImpl(url),
    });
  }

  function isNativeApp() {
    const { Capacitor } = globalThis;
    return Boolean(Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  }

  function install() {
    const { Preferences: preferences, Browser: browser, App: app } = globalThis.Capacitor.Plugins;
    const pageUrl = new URL(globalThis.location.href);
    const tokenStore = createTokenStore(preferences);
    const apiFetch = createApiFetch({
      nativeFetch: globalThis.fetch.bind(globalThis), tokenStore, pageUrl,
    });
    const context = {
      preferences, browser, apiFetch, WebSocketImpl: globalThis.WebSocket,
      TicketSocket: root.NativeSocket.TicketSocket,
      appleSignIn: globalThis.Capacitor.Plugins.AppleSignIn,
    };

    globalThis.fetch = apiFetch;
    openLinksInSystemBrowser({ document: globalThis.document, pageUrl, browser });
    app.addListener('appUrlOpen', event => finishGoogleSignIn(event.url, context));
    root.NativeShell = {
      isNative: true,
      platform: globalThis.Capacitor.getPlatform(),
      siteOrigin: API_ORIGIN,
      startGoogleSignIn: () => startGoogleSignIn(context),
      startAppleSignIn: () => startAppleSignIn(context),
      openLiveSocket: path => openLiveSocket(path, context),
    };
  }

  const NativeShell = {
    API_ORIGIN, toApiUrl, externalTargetFor, createTokenStore, createApiFetch, rememberSession,
    startGoogleSignIn, finishGoogleSignIn, startAppleSignIn, openLiveSocket,
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = NativeShell;
    return;
  }
  if (isNativeApp()) install();
  else root.NativeShell = { isNative: false, platform: 'web', siteOrigin: globalThis.location.origin };
})(this);
