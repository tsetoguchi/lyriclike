// The sidebar's feedback box: what reaches the inbox, and the limits that
// keep anyone from flooding it.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as feedback from '../functions/api/feedback.js';
import { addGoogleUser, addSession, events, makeEnv, post, stubServices } from './support/auth-harness.mjs';

const FEEDBACK = '/api/feedback';
const INBOX = 'tao@lyriclike.com';

let env;
let services;

beforeEach(() => {
  env = makeEnv({ FEEDBACK_EMAIL: INBOX });
  services = stubServices();
});

afterEach(() => {
  services.restore();
});

function send(message = 'The rhyme list is great', options = {}) {
  return post(feedback, env, FEEDBACK, { message }, options);
}

describe('feedback', () => {
  it('emails a visitor\'s message to the inbox, with no one to reply to', async () => {
    const response = await send('  Love the syllable counts  ');
    assert.equal(response.status, 200);
    assert.equal(services.mail.length, 1);
    const [mail] = services.mail;
    assert.deepEqual(mail.to, [INBOX]);
    assert.equal(mail.subject, 'Feedback: Love the syllable counts');
    assert.match(mail.text, /^Love the syllable counts\n\nFrom a visitor/);
    assert.equal(mail.reply_to, undefined);
  });

  it('lets the owner reply to a signed-in sender', async () => {
    await addGoogleUser(env, { id: 'u1', email: 'ann@example.com' });
    await addSession(env, 'u1', 'tok');
    await send('Hi', { cookie: 'sid=tok' });
    assert.equal(services.mail[0].reply_to, 'ann@example.com');
    assert.match(services.mail[0].text, /From ann@example\.com\./);
  });

  it('refuses an empty or overlong message without sending', async () => {
    assert.equal((await send('   ')).status, 400);
    assert.equal((await send('x'.repeat(feedback.MESSAGE_MAX_CHARS + 1))).status, 400);
    assert.equal(services.mail.length, 0);
  });

  it('gives each IP a few an hour', async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 429);
    assert.equal((await send('Hi', { ip: '198.51.100.9' })).status, 200);
  });

  it('stops for the day once the pool is used up', async () => {
    for (let i = 0; i < 10; i += 1) await send('Hi', { ip: `198.51.100.${i}` });
    const response = await send('One more', { ip: '198.51.100.99' });
    assert.equal(response.status, 503);
    assert.equal(services.mail.length, 10);
    assert.ok((await events(env)).includes('email_skipped_pool_feedback'));
  });

  it('says so when the mail did not go', async () => {
    services.mailDown = true;
    assert.equal((await send()).status, 502);
  });

  it('says so when no inbox is set', async () => {
    env = makeEnv();
    assert.equal((await send()).status, 502);
    assert.equal(services.mail.length, 0);
  });
});
