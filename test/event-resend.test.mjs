// Resending parked event hook messages: page loads claim a few due rows,
// try each once, and push the next try out or drop the row.
//
//   npm ci --prefix collab && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as me from '../functions/api/me.js';
import { MAX_ATTEMPTS, SWEEP_BATCH, claimDueEvents, sendParkedEvents } from '../functions/_event-resend.js';
import { BASE_URL, addSession, makeEnv, query } from './support/auth-harness.mjs';

const HOOK = { EVENT_HOOK_URL: 'https://hooks.example.com/events', EVENT_HOOK_SECRET: 'hook-secret' };
const NOW = 1_800_000_000_000;

let env;
let calls;
let answer;
let originalFetch;

async function exec(sql, ...params) {
  await env.lyricalmiracle_db.prepare(sql).bind(...params).run();
}

async function park(id, { attempts = 1, nextAttemptAt = NOW, createdAt = 1 } = {}) {
  const body = JSON.stringify({ id, type: 'page.deleted', data: { page_id: id } });
  await exec('INSERT INTO event_outbox (id, page_id, body, attempts, next_attempt_at, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?)', id, id, body, attempts, nextAttemptAt, createdAt);
}

function rows() {
  return query(env, 'SELECT id, attempts, next_attempt_at FROM event_outbox ORDER BY id');
}

const sweep = (options = {}) => sendParkedEvents(env, { now: () => NOW, random: () => 1, ...options });

beforeEach(() => {
  env = makeEnv(HOOK);
  calls = [];
  answer = async () => new Response(null, { status: 200 });
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(init);
    return answer();
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sendParkedEvents', () => {
  it('sends a due row and deletes it on 200', async () => {
    await park('a');
    await sweep();
    assert.equal(calls.length, 1);
    assert.deepEqual(await rows(), []);
  });

  it('leaves a row that is not due yet alone', async () => {
    await park('a', { nextAttemptAt: NOW + 1 });
    await sweep();
    assert.equal(calls.length, 0);
    assert.equal((await rows()).length, 1);
  });

  it('on a miss, bumps attempts and pushes the next try out', async () => {
    answer = async () => new Response(null, { status: 500 });
    await park('a');
    await sweep();
    assert.deepEqual(await rows(), [{ id: 'a', attempts: 2, next_attempt_at: NOW + 240_000 }]);
  });

  it('drops after MAX_ATTEMPTS and reports it', async () => {
    answer = async () => new Response(null, { status: 500 });
    await park('a', { attempts: MAX_ATTEMPTS - 1 });
    let dropped = 0;
    await sweep({ onDropped: () => { dropped += 1; } });
    assert.deepEqual(await rows(), []);
    assert.equal(dropped, 1);
  });

  it('a claim counts as a try even if the sweep never finishes', async () => {
    await park('a');
    const claimed = await claimDueEvents(env.lyricalmiracle_db, NOW);
    assert.equal(claimed.length, 1);
    assert.equal((await rows())[0].attempts, 2);
  });

  it('sends claimed rows side by side', async () => {
    for (const id of ['a', 'b', 'c']) await park(id);
    let release;
    const allStarted = new Promise(resolve => { release = resolve; });
    answer = async () => {
      if (calls.length === 3) release();
      await allStarted;
      return new Response(null, { status: 200 });
    };
    await sweep();
    assert.equal(calls.length, 3);
  });

  it('two sweeps at once send each row once', async () => {
    for (const id of ['a', 'b', 'c']) await park(id);
    await Promise.all([sweep(), sweep()]);
    assert.equal(calls.length, 3);
  });

  it('sends at most SWEEP_BATCH rows per sweep', async () => {
    for (let n = 0; n < SWEEP_BATCH + 2; n += 1) await park(`row-${String(n).padStart(2, '0')}`);
    await sweep();
    assert.equal(calls.length, SWEEP_BATCH);
  });

  it('the resend keeps the id and gets a fresh signature time', async () => {
    await park('a', { createdAt: 1 });
    await sweep();
    assert.equal(JSON.parse(calls[0].body).id, 'a');
    const seconds = Number(/^t=(\d+),/.exec(calls[0].headers['X-Event-Signature'])[1]);
    assert.ok(Math.abs(seconds - Date.now() / 1000) < 5);
  });

  it('never throws, even with the table gone', async () => {
    await exec('DROP TABLE event_outbox');
    await sweep();
  });
});

describe('/api/me', () => {
  async function loadPage() {
    await exec("INSERT INTO users (id, email, email_normalized, name, created_at) VALUES ('ann', 'a@x.com', 'a@x.com', 'ann', 1)");
    await addSession(env, 'ann', 'sid-ann');
    const pending = [];
    const request = new Request(`${BASE_URL}/api/me`, { headers: { Cookie: 'sid=sid-ann' } });
    const response = await me.onRequestGet({ request, env, waitUntil: p => pending.push(p) });
    await Promise.all(pending);
    return response;
  }

  it('sends due parked messages', async () => {
    await park('a', { nextAttemptAt: 0 });
    assert.equal((await loadPage()).status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(await rows(), []);
  });

  it('runs no outbox query with the hook unset', async () => {
    delete env.EVENT_HOOK_URL;
    const db = env.lyricalmiracle_db;
    const seen = [];
    const prepare = db.prepare.bind(db);
    db.prepare = sql => { seen.push(sql); return prepare(sql); };
    assert.equal((await loadPage()).status, 200);
    assert.equal(seen.filter(sql => sql.includes('event_outbox')).length, 0);
  });
});
