// Sends parked event hook messages again. Page loads call this, since a Pages
// project has no timer of its own.

import { isDelivered, postEvent } from './_event-hook.js';
import { retryDelay } from './_event-outbox.js';

// About one to two days of tries, then the message is dropped.
export const MAX_ATTEMPTS = 15;
export const SWEEP_BATCH = 10;
// A claimed row is hidden from other sweeps this long.
const CLAIM_MS = 60 * 1000;

// Claims due rows in one statement, so two sweeps never get the same row,
// and counts the try now, so a sweep cut short still uses one up.
export async function claimDueEvents(db, now) {
  const { results } = await db.prepare(`
    UPDATE event_outbox SET attempts = attempts + 1, next_attempt_at = ?
    WHERE id IN (
      SELECT id FROM event_outbox WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?
    )
    RETURNING id, body, attempts
  `).bind(now + CLAIM_MS, now, SWEEP_BATCH).all();
  return results;
}

async function settle(env, row, status, { now, random, onDropped }) {
  const db = env.lyricalmiracle_db;
  if (isDelivered(status)) {
    await db.prepare('DELETE FROM event_outbox WHERE id = ?').bind(row.id).run();
    return;
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await db.prepare('DELETE FROM event_outbox WHERE id = ?').bind(row.id).run();
    console.error('event hook message dropped', row.attempts);
    if (onDropped) await onDropped();
    return;
  }
  await db.prepare('UPDATE event_outbox SET next_attempt_at = ? WHERE id = ?')
    .bind(now + retryDelay(row.attempts, random), row.id).run();
}

async function resend(env, row, options) {
  const status = await postEvent(env, row.body);
  await settle(env, row, status, options);
}

// Never throws: it runs after a page load and must not touch it. The rows go
// out side by side, since one after another could run past waitUntil's time.
export async function sendParkedEvents(env, { now = Date.now, random = Math.random, onDropped } = {}) {
  try {
    const startedAt = now();
    const rows = await claimDueEvents(env.lyricalmiracle_db, startedAt);
    const options = { now: startedAt, random, onDropped };
    await Promise.all(rows.map(row => resend(env, row, options)));
  } catch (err) {
    console.error('event hook resend failed', err && err.message);
  }
}
