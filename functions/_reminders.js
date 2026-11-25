// The "your song is waiting" email. Once a day, every account whose latest
// page was last saved 3 days ago, with real writing on it and no visit since,
// gets one short email naming the song. Nobody gets more than one every 14
// days, and anyone can turn them off.
//
// One in five of the people who are due get no email, so the ones who do can
// be compared with them. Which ones is fixed by a hash of the account id.

import { sendReminderEmail } from './_email.js';
import { DAY_MS } from './_ratelimit.js';
import { sha256Hex } from './_shared.js';

const HOUR_MS = 60 * 60 * 1000;
// The job runs once a day, so a 24-hour window catches each page once.
const IDLE_FROM_MS = 72 * HOUR_MS;
const IDLE_UNTIL_MS = 96 * HOUR_MS;
const RESEND_GAP_MS = 14 * DAY_MS;
// No reminder in an account's first day.
const NEW_ACCOUNT_MS = DAY_MS;
const MIN_WRITTEN_LINES = 4;
// The first line of the sample verse (sample-verse.js). A page that still
// holds it is the sample, not the person's own song.
const SAMPLE_FIRST_LINE = '(This is a sample verse.)';
const APP_OPEN = 'app_open';
// The holdout: accounts whose hash lands in the first 20 of 100 buckets.
const HOLDOUT_PERCENT = 20;
const HOLDOUT_SALT = 'reminder-holdout:';
const BUCKET_COUNT = 100;
const BUCKET_HEX_DIGITS = 8;

// Each account's most recently saved page, when that save falls in the
// window and the account has not opened the app since.
const DUE_SQL = `
  SELECT u.id AS user_id, u.email, l.id AS lyric_id, l.title, l.body
  FROM users u
  JOIN lyrics l ON l.id = (
    SELECT id FROM lyrics WHERE user_id = u.id ORDER BY updated_at DESC LIMIT 1
  )
  WHERE u.created_at < ?
    AND l.updated_at BETWEEN ? AND ?
    AND NOT EXISTS (SELECT 1 FROM reminder_opt_outs o WHERE o.user_id = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM reminder_emails r WHERE r.user_id = u.id AND r.sent_at > ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM reminder_holds h WHERE h.user_id = u.id AND h.held_at > ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM logs g
      WHERE g.user_id = u.id AND g.event = ? AND g.created_at > l.updated_at
    )
`;

export function hasRealWriting(body) {
  const text = String(body || '');
  if (text.includes(SAMPLE_FIRST_LINE)) return false;
  const lines = text.split('\n').filter(line => line.trim() !== '');
  return lines.length >= MIN_WRITTEN_LINES;
}

export async function findDueReminders(env, now) {
  const { results } = await env.lyricalmiracle_db.prepare(DUE_SQL).bind(
    now - NEW_ACCOUNT_MS, now - IDLE_UNTIL_MS, now - IDLE_FROM_MS, now - RESEND_GAP_MS,
    now - RESEND_GAP_MS, APP_OPEN,
  ).all();
  return results.filter(row => hasRealWriting(row.body));
}

// The same account always lands in the same group.
export async function isHeldOut(userId) {
  const hex = await sha256Hex(HOLDOUT_SALT + userId);
  return parseInt(hex.slice(0, BUCKET_HEX_DIGITS), 16) % BUCKET_COUNT < HOLDOUT_PERCENT;
}

function recordHold(env, { user_id: userId, lyric_id: lyricId }, now) {
  return env.lyricalmiracle_db.prepare(`
    INSERT INTO reminder_holds (user_id, lyric_id, held_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET lyric_id = excluded.lyric_id, held_at = excluded.held_at
  `).bind(userId, lyricId, now).run();
}

function recordReminder(env, { user_id: userId, lyric_id: lyricId }, now) {
  return env.lyricalmiracle_db.prepare(`
    INSERT INTO reminder_emails (user_id, lyric_id, sent_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET lyric_id = excluded.lyric_id, sent_at = excluded.sent_at
  `).bind(userId, lyricId, now).run();
}

// Sends one at a time and stops once the day's reminder pool is full.
// Returns how many were due, how many went out and how many were held back.
export async function sendDueReminders(context, now = Date.now()) {
  const due = await findDueReminders(context.env, now);
  let sent = 0;
  let held = 0;
  for (const row of due) {
    if (await isHeldOut(row.user_id)) {
      await recordHold(context.env, row, now);
      held += 1;
      continue;
    }
    const result = await sendReminderEmail(context, {
      to: row.email, title: row.title, lyricId: row.lyric_id, userId: row.user_id,
    });
    if (result.isPoolFull) break;
    if (!result.sent) continue;
    await recordReminder(context.env, row, now);
    sent += 1;
  }
  return { due: due.length, sent, held };
}

export function setRemindersOn(env, userId, isOn, now = Date.now()) {
  const statement = isOn
    ? env.lyricalmiracle_db.prepare('DELETE FROM reminder_opt_outs WHERE user_id = ?').bind(userId)
    : env.lyricalmiracle_db.prepare(
      'INSERT INTO reminder_opt_outs (user_id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).bind(userId, now);
  return statement.run();
}
