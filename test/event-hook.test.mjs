// The event hook sender: signs a message, posts it, tries once more, and
// reports a second miss.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { isEventHookSet, sendEvent, signatureHeader } from '../functions/_event-hook.js';

const URL_SET = 'https://hooks.example.com/events';
const SECRET = 'hook-secret-not-a-secret';
const EVENT = { type: 'page.saved', data: { page_id: 'p1' } };
const noWait = async () => {};

let originalFetch;
let calls;

function fetchAnswers(...answers) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  };
}

async function hexHmac(secret, text) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join('');
}

const env = { EVENT_HOOK_URL: URL_SET, EVENT_HOOK_SECRET: SECRET };

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('isEventHookSet', () => {
  it('is unset when either value is missing', () => {
    assert.equal(isEventHookSet({}), false);
    assert.equal(isEventHookSet({ EVENT_HOOK_URL: URL_SET }), false);
    assert.equal(isEventHookSet({ EVENT_HOOK_SECRET: SECRET }), false);
    assert.equal(isEventHookSet({ EVENT_HOOK_URL: '', EVENT_HOOK_SECRET: '' }), false);
    assert.equal(isEventHookSet(env), true);
  });
});

describe('sendEvent', () => {
  it('signs the body so the secret checks it', async () => {
    fetchAnswers(200);
    await sendEvent(env, EVENT, { wait: noWait });

    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, URL_SET);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), EVENT);
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(init.headers['X-Event-Signature']);
    assert.ok(match);
    assert.ok(Math.abs(Number(match[1]) - Date.now() / 1000) < 5);
    assert.equal(match[2], await hexHmac(SECRET, `${match[1]}.${init.body}`));
  });

  it('makes the same header as signatureHeader', async () => {
    const header = await signatureHeader(SECRET, 'body', 100);
    assert.equal(header, `t=100,v1=${await hexHmac(SECRET, '100.body')}`);
  });

  it('tries again after one failure, and stops when it lands', async () => {
    fetchAnswers(500, 200);
    let failed = 0;
    await sendEvent(env, EVENT, { wait: noWait, onFailed: () => { failed += 1; } });
    assert.equal(calls.length, 2);
    assert.equal(failed, 0);
  });

  it('calls onFailed once after two failures', async () => {
    fetchAnswers(503, 503);
    let failed = 0;
    await sendEvent(env, EVENT, { wait: noWait, onFailed: () => { failed += 1; } });
    assert.equal(calls.length, 2);
    assert.equal(failed, 1);
  });

  it('counts a network error as a failure', async () => {
    fetchAnswers(new Error('down'), new Error('down'));
    let failed = 0;
    await sendEvent(env, EVENT, { wait: noWait, onFailed: () => { failed += 1; } });
    assert.equal(failed, 1);
  });

  it('swallows a throw from onFailed', async () => {
    fetchAnswers(500, 500);
    await sendEvent(env, EVENT, { wait: noWait, onFailed: () => { throw new Error('log down'); } });
  });

  it('logs only the type and status, never the body or the address', async () => {
    fetchAnswers(500, 502);
    const lines = [];
    const originalError = console.error;
    console.error = (...args) => lines.push(args.map(String).join(' '));
    try {
      await sendEvent(env, { type: 'page.saved', data: { body: 'secret words' } }, { wait: noWait });
    } finally {
      console.error = originalError;
    }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /page\.saved/);
    assert.match(lines[0], /502/);
    assert.doesNotMatch(lines[0], /secret words|hooks\.example/);
  });
});
