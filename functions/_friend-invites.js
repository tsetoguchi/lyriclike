// Inviting a friend: each account's invite code, a new account taking the code
// it arrived with, and the extra pages both sides get once the friend saves a
// page. The bonus only ever adds to a page limit; with no limit it does nothing.

import { DAY_MS } from './_ratelimit.js';
import { randomHex } from './_shared.js';

export const BONUS_PAGES_PER_FRIEND = 2;
export const MAX_REWARDED_FRIENDS = 5;

const CODE_BYTES = 5;
const CODE_PATTERN = /^[0-9a-f]{10}$/;
// Only an account this new can say who invited it, so an old account can't
// pick up a bonus from any link it sees.
const CLAIM_WINDOW_MS = DAY_MS;

export function isCodeShaped(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code);
}

// The inviter's share stops growing at MAX_REWARDED_FRIENDS; the friend's own
// one-time share sits on top of it.
export function inviteBonusPages(rewardedFriends, wasInvited) {
  const friends = Math.min(rewardedFriends, MAX_REWARDED_FRIENDS) + (wasInvited ? 1 : 0);
  return friends * BONUS_PAGES_PER_FRIEND;
}

// Another account holding the same random code is rare enough to just try a
// fresh one, which the loop does once.
export async function findOrCreateInviteCode(env, userId) {
  const db = env.lyricalmiracle_db;
  for (let attempt = 0; attempt < 2; attempt++) {
    await db.prepare(`
      INSERT INTO invite_codes (user_id, code, created_at) VALUES (?, ?, ?)
      ON CONFLICT DO NOTHING
    `).bind(userId, randomHex(CODE_BYTES), Date.now()).run();
    const row = await db.prepare('SELECT code FROM invite_codes WHERE user_id = ?')
      .bind(userId).first();
    if (row) return row.code;
  }
  throw new Error('invite code not created');
}

export async function countRewardedFriends(env, userId) {
  const row = await env.lyricalmiracle_db.prepare(
    'SELECT count(*) AS n FROM friend_invites WHERE inviter_id = ? AND rewarded_at IS NOT NULL'
  ).bind(userId).first();
  return row.n;
}

// Records who invited a new account. A friend who already saved a page is
// rewarded at once. Returns whether the code was taken.
export async function claimInvite(env, friendId, code, now) {
  const db = env.lyricalmiracle_db;
  const created = await db.prepare(`
    INSERT INTO friend_invites (friend_id, inviter_id, created_at, rewarded_at)
    SELECT ?, invite_codes.user_id, ?,
      CASE WHEN EXISTS (SELECT 1 FROM lyrics WHERE user_id = ?) THEN ? END
    FROM invite_codes
    WHERE invite_codes.code = ? AND invite_codes.user_id != ?
      AND (SELECT created_at FROM users WHERE id = ?) > ?
    ON CONFLICT(friend_id) DO NOTHING
  `).bind(friendId, now, friendId, now, code, friendId, friendId, now - CLAIM_WINDOW_MS).run();
  return created.meta.changes > 0;
}

// Runs on every new page; only a friend's first one changes anything.
export function rewardFriendInvite(env, friendId, now) {
  return env.lyricalmiracle_db.prepare(
    'UPDATE friend_invites SET rewarded_at = ? WHERE friend_id = ? AND rewarded_at IS NULL'
  ).bind(now, friendId).run();
}
