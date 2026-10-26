// The room's event sender: nothing at all when the hook is unset; else one
// signed post per message, kept alive with waitUntil, and a log row when
// both tries miss.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createEventSender } from '../collab/src/room-hook.js';
import { createFakeD1 } from './support/fake-d1.mjs';

const EVENT = { type: 'page.saved', data: { page_id: 'p1' } };
const NOW = 1_000_000;

let originalFetch;
let calls;
let waited;

function fetchAnswers(...answers) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: answers.shift() });
  };
}

function setEnv(db) {
  return { EVENT_HOOK_URL: 'https://hooks.example.com/events', EVENT_HOOK_SECRET: 's', lyricalmiracle_db: db };
}

function senderFor(env) {
  return createEventSender({ env, waitUntil: promise => waited.push(promise), now: () => NOW });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  calls = [];
  waited = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('the room event sender', () => {
  it('unset: no fetch and no waitUntil', () => {
    fetchAnswers(200, 200, 200);
    for (const env of [{}, { EVENT_HOOK_URL: 'https://hooks.example.com/events' }, { EVENT_HOOK_SECRET: 's' }]) {
      const send = senderFor(env);
      send(EVENT);
      send(EVENT);
      send(EVENT);
    }
    assert.equal(calls.length, 0);
    assert.equal(waited.length, 0);
  });

  it('set: one signed post per message', async () => {
    fetchAnswers(200);
    senderFor(setEnv(createFakeD1()))(EVENT);
    assert.equal(waited.length, 1);
    await Promise.all(waited);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://hooks.example.com/events');
    assert.match(calls[0].init.headers['X-Event-Signature'], /^t=\d+,v1=[0-9a-f]{64}$/);
    const { id, ...sent } = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent, EVENT);
    assert.ok(id);
  });

  it("one room's messages go out in order, even when the first is retried", async () => {
    fetchAnswers(500, 200, 200);
    const send = senderFor(setEnv(createFakeD1()));
    send({ type: 'page.saved', data: { n: 1 } });
    send({ type: 'page.saved', data: { n: 2 } });
    await Promise.all(waited);
    assert.deepEqual(calls.map(call => JSON.parse(call.init.body).data.n), [1, 1, 2]);
  });

  it('two failures park the message, at the room clock', async () => {
    fetchAnswers(500, 500);
    const db = createFakeD1();
    await db.prepare("INSERT INTO users (id, email, email_normalized, name, created_at) VALUES ('u', 'u@x.com', 'u@x.com', 'u', 1)").run();
    await db.prepare("INSERT INTO lyrics (id, user_id, title, body, revision, updated_at, created_at) VALUES ('p1', 'u', '', '', 0, 1, 1)").run();
    senderFor(setEnv(db))(EVENT);
    await Promise.all(waited);
    const { results } = await db.prepare('SELECT page_id, created_at FROM event_outbox').all();
    assert.deepEqual(results, [{ page_id: 'p1', created_at: NOW }]);
    assert.deepEqual((await db.prepare('SELECT event FROM logs').all()).results, []);
  });

  it('a failed park writes one log row with no user', async () => {
    fetchAnswers(500, 500);
    const db = createFakeD1();
    await db.prepare('DROP TABLE event_outbox').run();
    senderFor(setEnv(db))(EVENT);
    await Promise.all(waited);
    const { results } = await db.prepare('SELECT user_id, event, created_at FROM logs').all();
    assert.deepEqual(results, [{ user_id: null, event: 'event_hook_failed', created_at: NOW }]);
  });
});
