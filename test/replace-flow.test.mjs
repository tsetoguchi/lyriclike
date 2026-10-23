// The order of a whole-page replace: the editor is locked before the last
// save, so nothing typed can slip past it, and stays locked until the answer
// is in; nothing is sent to or applied on a page that was swapped meanwhile.
// Fake steps log their names, so Node can run it.
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
    hasUnsaved: () => false,
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
  it('locks, then flushes, sends, unlocks, applies', async () => {
    const log = [];
    const result = await runReplace(makeSteps(log), WORDS);
    assert.deepEqual(log, ['lock', 'flush', 'send', 'unlock', 'apply']);
    assert.deepEqual(result, { ok: true });
  });

  it('a save still out is waited for before sending', async () => {
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
    const readiness = () => 'not-ready';
    const result = await runReplace(makeSteps(log, { readiness }), WORDS);
    assert.deepEqual(log, []);
    assert.deepEqual(result, { ok: false, reason: 'not-ready' });
  });

  it('not ready after the flush sends nothing and unlocks', async () => {
    const log = [];
    const answers = [null, 'not-ready'];
    const readiness = () => answers.shift();
    const result = await runReplace(makeSteps(log, { readiness }), WORDS);
    assert.deepEqual(log, ['lock', 'flush', 'unlock']);
    assert.deepEqual(result, { ok: false, reason: 'not-ready' });
  });

  it('words a failed save left behind are not replaced', async () => {
    const log = [];
    const result = await runReplace(makeSteps(log, { hasUnsaved: () => true }), WORDS);
    assert.deepEqual(log, ['lock', 'flush', 'unlock']);
    assert.deepEqual(result, { ok: false, reason: 'not-ready' });
  });

  it('a flush that throws sends nothing and unlocks', async () => {
    const log = [];
    const flush = async () => { log.push('flush'); throw new Error('network'); };
    const result = await runReplace(makeSteps(log, { flush }), WORDS);
    assert.deepEqual(log, ['lock', 'flush', 'unlock']);
    assert.deepEqual(result, { ok: false, reason: 'offline' });
  });

  it('a second replace while one runs is busy and touches nothing', async () => {
    const firstLog = [];
    let answerFirst;
    const send = () => new Promise((resolve) => {
      firstLog.push('send');
      answerFirst = () => resolve({ status: 200, answer: ANSWER });
    });
    const first = runReplace(makeSteps(firstLog, { send }), WORDS);
    await new Promise((resolve) => setImmediate(resolve));
    const secondLog = [];
    const second = await runReplace(makeSteps(secondLog), WORDS);
    assert.deepEqual(second, { ok: false, reason: 'busy' });
    assert.deepEqual(secondLog, []);
    answerFirst();
    assert.deepEqual(await first, { ok: true });
    const third = await runReplace(makeSteps([]), WORDS);
    assert.deepEqual(third, { ok: true });
  });

  it('another page opened during the flush: nothing sent', async () => {
    const log = [];
    let openId = 'a';
    const flush = async () => { log.push('flush'); openId = 'b'; };
    const steps = makeSteps(log, { flush, pageId: () => openId });
    const result = await runReplace(steps, WORDS);
    assert.deepEqual(result, { ok: false, reason: 'page-changed' });
    assert.ok(!log.includes('send'));
    assert.ok(log.includes('unlock'));
  });

  it('another page opened while sending: nothing applied', async () => {
    const log = [];
    let openId = 'a';
    const send = async () => {
      log.push('send');
      openId = 'b';
      return { status: 200, answer: ANSWER };
    };
    const steps = makeSteps(log, { send, pageId: () => openId });
    const result = await runReplace(steps, WORDS);
    assert.deepEqual(result, { ok: false, reason: 'page-changed' });
    assert.ok(log.includes('send'));
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
      const send = answerWith(log, status);
      const result = await runReplace(makeSteps(log, { send }), WORDS);
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
