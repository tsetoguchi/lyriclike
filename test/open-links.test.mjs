// Page links that open the iOS app: the Apple file that claims them, the
// website's /open/<page> fallback, and the app shell turning one into the
// page's usual link.
//
//   node --test test/open-links.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import * as openRoute from '../functions/open/[id].js';

const require = createRequire(import.meta.url);
const { pageLinkHash } = require('../native-shell.js');

const SITE = 'https://lyriclike.com';
const PAGE_ID = '347d2793-5779-412b-a489-8e4de4e0e2df';

function open(path) {
  const request = new Request(`${SITE}${path}`);
  const id = decodeURIComponent(new URL(request.url).pathname.split('/')[2] || '');
  return openRoute.onRequestGet({ request, params: { id } });
}

describe('the Apple file', () => {
  const file = new URL('../.well-known/apple-app-site-association', import.meta.url);
  const aasa = JSON.parse(readFileSync(file, 'utf8'));

  it('names the iOS app and claims only /open/ links', () => {
    const [detail] = aasa.applinks.details;
    assert.deepEqual(detail.appIDs, ['484VZ7RM5N.com.lyriclike.app']);
    assert.deepEqual(detail.components.map(component => component['/']), ['/open/*']);
  });

  it('is served as JSON', () => {
    const headers = readFileSync(new URL('../_headers', import.meta.url), 'utf8');
    assert.match(headers,
      /\/\.well-known\/apple-app-site-association\r?\n {2}Content-Type: application\/json/);
  });

  it('matches the app\'s associated domain', () => {
    const entitlements = readFileSync(
      new URL('../mobile/ios/App/App/App.entitlements', import.meta.url), 'utf8');
    assert.match(entitlements, /<string>applinks:lyriclike\.com<\/string>/);
  });
});

describe('/open/<page> on the website', () => {
  it('sends a browser on to the shared-page link, keeping where it came from', () => {
    const response = open(`/open/${PAGE_ID}?from=reminder`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('Location'), `${SITE}/#shared=${PAGE_ID}&from=reminder`);
  });

  it('leaves out a from that is not a plain word', () => {
    const response = open(`/open/${PAGE_ID}?from=%3Cscript%3E`);
    assert.equal(response.headers.get('Location'), `${SITE}/#shared=${PAGE_ID}`);
  });

  it('sends a bad page id home', () => {
    const response = open('/open/not%20a%20page');
    assert.equal(response.headers.get('Location'), `${SITE}/`);
  });
});

describe('the app opening a page link', () => {
  it('turns an /open/ link into the page\'s usual fragment', () => {
    assert.equal(pageLinkHash(`${SITE}/open/${PAGE_ID}?from=reminder`),
      `#shared=${PAGE_ID}&from=reminder`);
    assert.equal(pageLinkHash(`${SITE}/open/${PAGE_ID}/`), `#shared=${PAGE_ID}`);
  });

  it('ignores the sign-in return, other sites and other paths', () => {
    assert.equal(pageLinkHash('lyriclike://auth?code=abc'), null);
    assert.equal(pageLinkHash(`https://evil.example/open/${PAGE_ID}`), null);
    assert.equal(pageLinkHash(`${SITE}/rhymes/love/`), null);
    assert.equal(pageLinkHash('not a url'), null);
  });

  it('sets the fragment when the app is handed the link', () => {
    const listeners = [];
    const page = {
      URL, CustomEvent: class { constructor(type) { this.type = type; } },
      location: new URL('capacitor://localhost/index.html'),
      document: { addEventListener: () => {}, dispatchEvent: () => {} },
      fetch: async () => Response.json({}), WebSocket: class {},
      NativeSocket: { TicketSocket: class {} },
      console: { error: () => {} }, setTimeout, crypto: globalThis.crypto,
      Capacitor: {
        isNativePlatform: () => true, getPlatform: () => 'ios',
        Plugins: {
          Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
          Browser: { open: async () => {} }, AppleSignIn: {},
          App: { addListener: (name, callback) => listeners.push({ name, callback }) },
        },
      },
    };
    const source = readFileSync(new URL('../native-shell.js', import.meta.url), 'utf8');
    vm.runInNewContext(source, page);
    for (const { name, callback } of listeners) {
      if (name === 'appUrlOpen') callback({ url: `${SITE}/open/${PAGE_ID}?from=reminder` });
    }
    assert.equal(page.location.hash, `#shared=${PAGE_ID}&from=reminder`);
  });
});
