// Inviting a friend: each account's invite code, a new account taking the code
// it arrived with, and the extra pages both sides get once the friend saves a
// page. The bonus only ever adds to a page limit; with no limit it does nothing.
// INVITE_BONUS_PAGES sets the pages per friend; 0 turns the bonus off.

import { DAY_MS } from './_ratelimit.js';
import { randomHex } from './_shared.js';

export const DEFAULT_BONUS_PAGES_PER_FRIEND = 2;
export const MAX_REWARDED_FRIENDS = 5;

const CODE_BYTES = 5;
const CODE_PATTERN = /^[0-9a-f]{10}$/;
// Only an account this new can say who invited it, so an old account can't
// pick up a bonus from any link it sees.
const CLAIM_WINDOW_MS = DAY_MS;
const WHOLE_NUMBER = /^\d+$/;

export function isCodeShaped(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code);
}

// Anything but a whole number keeps the default, so a typo can't take pages
// away by accident.
export function bonusPagesPerFriend(env) {
  const value = env.INVITE_BONUS_PAGES;
  const isWholeNumber = typeof value === 'string' && WHOLE_NUMBER.test(value);
  return isWholeNumber ? Number(value) : DEFAULT_BONUS_PAGES_PER_FRIEND;
}

// The inviter's share stops growing at MAX_REWARDED_FRIENDS; the friend's own
// one-time share sits on top of it.
export function inviteBonusPages(env, rewardedFriends, wasInvited) {
  const friends = Math.min(rewardedFriends, MAX_REWARDED_FRIENDS) + (wasInvited ? 1 : 0);
  return friends * bonusPagesPerFriend(env);
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
// rewarded at once. Returns whether the code was taken, whether the reward
// came with it, and who the inviter is.
export async function claimInvite(env, friendId, code, now) {
  const created = await env.lyricalmiracle_db.prepare(`
    INSERT INTO friend_invites (friend_id, inviter_id, created_at, rewarded_at)
    SELECT ?, invite_codes.user_id, ?,
      CASE WHEN EXISTS (SELECT 1 FROM lyrics WHERE user_id = ?) THEN ? END
    FROM invite_codes
    WHERE invite_codes.code = ? AND invite_codes.user_id != ?
      AND (SELECT created_at FROM users WHERE id = ?) > ?
    ON CONFLICT(friend_id) DO NOTHING
    RETURNING inviter_id, rewarded_at
  `).bind(friendId, now, friendId, now, code, friendId, friendId, now - CLAIM_WINDOW_MS).first();
  return {
    isClaimed: Boolean(created),
    isRewarded: Boolean(created && created.rewarded_at),
    inviterId: created ? created.inviter_id : null,
  };
}

// Runs on every new page; only a friend's first one changes anything.
// Returns the inviter when this page set off the reward, otherwise null.
export async function rewardFriendInvite(env, friendId, now) {
  const rewarded = await env.lyricalmiracle_db.prepare(`
    UPDATE friend_invites SET rewarded_at = ? WHERE friend_id = ? AND rewarded_at IS NULL
    RETURNING inviter_id
  `).bind(now, friendId).first();
  return rewarded ? rewarded.inviter_id : null;
}
