// The order of a whole-page replace: saves still out land first, the editor
// is locked while the request is out, and nothing is applied to a page that
// was swapped meanwhile. Fake steps log their names, so Node can run it.
//
//   node --test test/replace-flow.test.mjs

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import replaceFlow from '../replace-flow.js';

const { runReplace } = replaceFlow;

const WORDS = { title: 'T', body: 'new words', tag: null };
const ANSWER = { id: 'a', title: 'T', revision: 2, updated_at: 'now', live: false };
const FLUSH_DELAY_MS = 20;

function makeSteps(log, overrides = {}) {
  return {
    readiness: () => null,
    flush: async () => { log.push('flush'); },
    pageId: () => 'a',
    lock: () => { log.push('lock'); return true; },
    unlock: () => { log.push('unlock'); },
    send: async () => { log.push('send'); return { status: 200, answer: ANSWER }; },
    apply: () => { log.push('apply'); },
    ...overrides,
  };
}

function answerWith(log, status) {
  return async () => { log.push('send'); return { status, answer: {} }; };
}

describe('runReplace', () => {
  it('flushes, then locks, sends, unlocks, applies', async () => {
    const log = [];
    const result = await runReplace(makeSteps(log), WORDS);
    assert.deepEqual(log, ['flush', 'lock', 'send', 'unlock', 'apply']);
    assert.deepEqual(result, { ok: true });
  });

  it('a flush still out is waited for before sending', async () => {
    const log = [];
    const flush = () => new Promise((resolve) => {
      setTimeout(() => { log.push('saved'); resolve(); }, FLUSH_DELAY_MS);
    });
    await runReplace(makeSteps(log, { flush }), WORDS);
    assert.ok(log.indexOf('saved') < log.indexOf('send'));
    assert.notEqual(log.indexOf('saved'), -1);
  });

  it('not ready sends nothing', async () => {
    const log = [];
    const result = await runReplace(makeSteps(log, { readiness: () => 'not-ready' }), WORDS);
    assert.deepEqual(log, []);
    assert.deepEqual(result, { ok: false, reason: 'not-ready' });
  });

  it('a flush that opens a conflict sends nothing', async () => {
    const log = [];
    const answers = [null, 'not-ready'];
    const readiness = () => answers.shift();
    const result = await runReplace(makeSteps(log, { readiness }), WORDS);
    assert.deepEqual(log, ['flush']);
    assert.deepEqual(result, { ok: false, reason: 'not-ready' });
  });

  it('another page opened meanwhile: nothing applied', async () => {
    const log = [];
    const ids = ['a', 'b'];
    const pageId = () => ids.shift();
    const result = await runReplace(makeSteps(log, { pageId }), WORDS);
    assert.deepEqual(result, { ok: false, reason: 'page-changed' });
    assert.ok(!log.includes('apply'));
    assert.ok(log.includes('unlock'));
  });

  it('a 409 is busy, a 403 is its status, a throw is offline', async () => {
    const cases = [
      [409, 'busy'],
      [503, 'busy'],
      [403, '403'],
      [404, '404'],
    ];
    for (const [status, reason] of cases) {
      const log = [];
      const result = await runReplace(makeSteps(log, { send: answerWith(log, status) }), WORDS);
      assert.deepEqual(result, { ok: false, reason });
      assert.ok(log.includes('unlock'));
      assert.ok(!log.includes('apply'));
    }
    const log = [];
    const send = async () => { log.push('send'); throw new Error('network'); };
    const result = await runReplace(makeSteps(log, { send }), WORDS);
    assert.deepEqual(result, { ok: false, reason: 'offline' });
    assert.ok(log.includes('unlock'));
  });

  it('unlock gets what lock answered', async () => {
    const log = [];
    let unlockedWith;
    const steps = makeSteps(log, {
      lock: () => false,
      unlock: (wasEditable) => { unlockedWith = wasEditable; },
    });
    await runReplace(steps, WORDS);
    assert.equal(unlockedWith, false);
  });

  it('sends the words to the page noted before the lock', async () => {
    const log = [];
    let sent;
    const send = async (id, words) => {
      sent = { id, words };
      return { status: 200, answer: ANSWER };
    };
    await runReplace(makeSteps(log, { send }), WORDS);
    assert.deepEqual(sent, { id: 'a', words: WORDS });
  });

  it('apply gets the answer and the words sent', async () => {
    const log = [];
    let applied;
    const apply = (answer, words) => { applied = { answer, words }; };
    await runReplace(makeSteps(log, { apply }), WORDS);
    assert.deepEqual(applied, { answer: ANSWER, words: WORDS });
  });
});
