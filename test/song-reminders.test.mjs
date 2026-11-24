// The "your song is waiting" email: who is due, what the email says, the
// daily run in the reminders Worker, and the two ways to turn it off.
//
//   node --test test/song-reminders.test.mjs

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { reminderStopToken } from '../functions/_email.js';
import { findDueReminders, hasRealWriting } from '../functions/_reminders.js';
import * as account from '../functions/api/account.js';
import * as remindersSetting from '../functions/api/me/reminders.js';
import * as stop from '../functions/api/reminders/stop.js';
import { runReminders } from '../reminders/src/index.js';
import {
  addGoogleUser, addSession, BASE_URL, makeEnv, post, query, stubServices,
} from './support/auth-harness.mjs';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const NOW = 1_800_000_000_000;
const SONG = 'one line\ntwo line\nthree line\nfour line';
const SECRET_WORDS = 'four line';
const ANN = { id: 'ann-1', email: 'ann@example.com', token: 'ann-token' };
const REMINDER_SETTINGS = {
  REMINDER_SIGNING_SECRET: 'reminder-secret-not-a-secret',
};

let env;
let services;

async function addSong(userId, { id = 'song-1', title = 'Midnight Drive', body = SONG,
  updatedAt = NOW - 80 * HOUR_MS } = {}) {
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO lyrics (id, user_id, title, body, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, title, body, updatedAt, 1).run();
}

async function addVisit(userId, at) {
  await env.lyricalmiracle_db.prepare(
    "INSERT INTO logs (id, user_id, event, created_at) VALUES (?, ?, 'app_open', ?)"
  ).bind(`visit-${at}`, userId, at).run();
}

async function dueIds() {
  return (await findDueReminders(env, NOW)).map(row => row.user_id);
}

beforeEach(async () => {
  env = makeEnv(REMINDER_SETTINGS);
  services = stubServices();
  await addGoogleUser(env, { id: ANN.id, email: ANN.email });
  await addSession(env, ANN.id, ANN.token);
});

afterEach(() => services.restore());

describe('who is due a reminder', () => {
  it('a song last saved 3 days ago, with no visit since', async () => {
    await addSong(ANN.id);
    assert.deepEqual(await dueIds(), [ANN.id]);
  });

  it('not a song saved under 3 days or over 4 days ago', async () => {
    await addSong(ANN.id, { updatedAt: NOW - 70 * HOUR_MS });
    assert.deepEqual(await dueIds(), []);
    await env.lyricalmiracle_db.prepare('UPDATE lyrics SET updated_at = ?')
      .bind(NOW - 100 * HOUR_MS).run();
    assert.deepEqual(await dueIds(), []);
  });

  it('only the newest song counts, so an older idle one sends nothing', async () => {
    await addSong(ANN.id, { id: 'old', updatedAt: NOW - 80 * HOUR_MS });
    await addSong(ANN.id, { id: 'new', updatedAt: NOW - HOUR_MS });
    assert.deepEqual(await dueIds(), []);
  });

  it('not after a visit since the save', async () => {
    await addSong(ANN.id);
    await addVisit(ANN.id, NOW - 10 * HOUR_MS);
    assert.deepEqual(await dueIds(), []);
  });

  it('a visit before the save does not count', async () => {
    await addSong(ANN.id);
    await addVisit(ANN.id, NOW - 90 * HOUR_MS);
    assert.deepEqual(await dueIds(), [ANN.id]);
  });

  it('not for an account that turned them off', async () => {
    await addSong(ANN.id);
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO reminder_opt_outs (user_id, created_at) VALUES (?, ?)'
    ).bind(ANN.id, 1).run();
    assert.deepEqual(await dueIds(), []);
  });

  it('not within 14 days of the last one', async () => {
    await addSong(ANN.id);
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO reminder_emails (user_id, lyric_id, sent_at) VALUES (?, ?, ?)'
    ).bind(ANN.id, 'other', NOW - 13 * DAY_MS).run();
    assert.deepEqual(await dueIds(), []);
  });

  it('not in an account\'s first day', async () => {
    await env.lyricalmiracle_db.prepare('UPDATE users SET created_at = ?')
      .bind(NOW - HOUR_MS).run();
    await addSong(ANN.id);
    assert.deepEqual(await dueIds(), []);
  });

  it('only real writing: 4 lines or more, and not the sample verse', () => {
    assert.equal(hasRealWriting(SONG), true);
    assert.equal(hasRealWriting('one\n\ntwo\n  \nthree'), false);
    assert.equal(hasRealWriting(`(This is a sample verse.)\n${SONG}`), false);
    assert.equal(hasRealWriting(''), false);
  });
});

describe('the daily run', () => {
  it('sends one email with the title and never the words', async () => {
    await addSong(ANN.id);
    assert.deepEqual(await runReminders(env, NOW), { due: 1, sent: 1 });
    const [mail] = services.mail;
    assert.deepEqual(mail.to, [ANN.email]);
    assert.equal(mail.subject, 'Your song "Midnight Drive" is waiting');
    assert.match(mail.text, /#shared=song-1&from=reminder/);
    assert.match(mail.text, /#reminder_stop=ann-1\./);
    assert.ok(!mail.text.includes(SECRET_WORDS));
    assert.ok(!mail.html.includes(SECRET_WORDS));
    assert.match(mail.headers['List-Unsubscribe'], /\/api\/reminders\/stop\?token=ann-1\./);
    assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  });

  it('names an untitled song as such', async () => {
    await addSong(ANN.id, { title: 'Untitled' });
    await runReminders(env, NOW);
    assert.equal(services.mail[0].subject, 'Your untitled song is waiting');
  });

  it('records the send, so a second run the same day sends nothing', async () => {
    await addSong(ANN.id);
    await runReminders(env, NOW);
    assert.deepEqual(await runReminders(env, NOW + HOUR_MS), { due: 0, sent: 0 });
    assert.equal(services.mail.length, 1);
    const [row] = await query(env, 'SELECT lyric_id, sent_at FROM reminder_emails');
    assert.deepEqual({ ...row }, { lyric_id: 'song-1', sent_at: NOW });
  });

  it('a failed send is not recorded, so it can go out another day', async () => {
    await addSong(ANN.id);
    services.mailDown = true;
    assert.deepEqual(await runReminders(env, NOW), { due: 1, sent: 0 });
    assert.deepEqual(await query(env, 'SELECT * FROM reminder_emails'), []);
  });

  it('does nothing until every secret is set', async () => {
    await addSong(ANN.id);
    const result = await runReminders({ ...env, REMINDER_SIGNING_SECRET: '' }, NOW);
    assert.deepEqual(result, { skipped: ['REMINDER_SIGNING_SECRET'] });
    assert.equal(services.mail.length, 0);
  });
});

describe('turning reminders off', () => {
  it('the emailed link turns them off for that account', async () => {
    const token = await reminderStopToken(env, ANN.id);
    const response = await post(stop, env, '/api/reminders/stop', { token });
    assert.equal(response.status, 200);
    assert.equal((await query(env, 'SELECT user_id FROM reminder_opt_outs'))[0].user_id, ANN.id);
  });

  it('a mail app\'s one-click POST with ?token= works too', async () => {
    const token = await reminderStopToken(env, ANN.id);
    const response = await post(stop, env, `/api/reminders/stop?token=${token}`,
      'List-Unsubscribe=One-Click',
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(response.status, 200);
    assert.equal((await query(env, 'SELECT * FROM reminder_opt_outs')).length, 1);
  });

  it('a forged token answers the same and changes nothing', async () => {
    const response = await post(stop, env, '/api/reminders/stop', { token: `${ANN.id}.${'A'.repeat(43)}` });
    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM reminder_opt_outs'), []);
  });

  it('the account menu switch turns them off and on, and the account says so', async () => {
    // post() calls onRequestPost, so the PUT handler stands in under that name.
    const handler = { onRequestPost: remindersSetting.onRequestPut };
    const send = on => post(handler, env, '/api/me/reminders', { on },
      { method: 'PUT', cookie: `sid=${ANN.token}` });
    const off = await (await send(false)).json();
    assert.equal(off.user.reminders_on, false);
    const on = await (await send(true)).json();
    assert.equal(on.user.reminders_on, true);
  });

  it('the switch refuses a body without a true or false', async () => {
    const handler = { onRequestPost: remindersSetting.onRequestPut };
    const response = await post(handler, env, '/api/me/reminders', { on: 'yes' },
      { method: 'PUT', cookie: `sid=${ANN.token}` });
    assert.equal(response.status, 400);
  });
});

describe('deleting the account', () => {
  it('takes its reminder rows with it', async () => {
    await addSong(ANN.id);
    await runReminders(env, NOW);
    await env.lyricalmiracle_db.prepare(
      'INSERT INTO reminder_opt_outs (user_id, created_at) VALUES (?, ?)'
    ).bind(ANN.id, 1).run();
    const request = new Request(`${BASE_URL}/api/account`, {
      method: 'DELETE', headers: { Cookie: `sid=${ANN.token}` },
    });
    const response = await account.onRequestDelete({ request, env, waitUntil: () => {} });
    assert.equal(response.status, 200);
    assert.deepEqual(await query(env, 'SELECT * FROM reminder_emails'), []);
    assert.deepEqual(await query(env, 'SELECT * FROM reminder_opt_outs'), []);
  });
});
