// Per-account limits on pages and on people per page. A site sets defaults in
// its settings; a user_limits row overrides them for one account. With no
// settings at all (a self-hosted copy) nothing is limited.

import { inviteBonusPages } from './_friend-invites.js';

export const UNLIMITED = -1;

const ENFORCED_VALUE = 'on';
const WHOLE_NUMBER = /^\d+$/;

// Only the exact word turns refusals on, so a typo like "true" stays safe.
export function isLimitsEnforced(env) {
  return env.LIMITS_ENFORCED === ENFORCED_VALUE;
}

// A whole number of 0 or more is a limit; anything else (unset, empty, "five",
// "-3", "1.5") means no limit rather than a surprise limit of 0.
function parseSiteDefault(value) {
  if (typeof value !== 'string' || !WHOLE_NUMBER.test(value)) return null;
  return Number(value);
}

// The row's value wins; a NULL column falls back to the site default, and
// UNLIMITED becomes null so callers only ever see a number or "no limit".
function pickLimit(rowValue, siteDefault) {
  if (rowValue === null || rowValue === undefined) return siteDefault;
  return rowValue === UNLIMITED ? null : rowValue;
}

// Friends who joined through this account's invite link raise its page limit;
// with no limit there is nothing to raise.
function addInviteBonus(env, pageLimit, row) {
  if (pageLimit === null) return null;
  return pageLimit + inviteBonusPages(env, row.rewarded_friends, Boolean(row.was_invited));
}

export async function findLimits(env, userId) {
  const row = await env.lyricalmiracle_db.prepare(`
    SELECT
      (SELECT page_limit FROM user_limits WHERE user_id = ?) AS page_limit,
      (SELECT people_limit FROM user_limits WHERE user_id = ?) AS people_limit,
      (SELECT count(*) FROM friend_invites
        WHERE inviter_id = ? AND rewarded_at IS NOT NULL) AS rewarded_friends,
      EXISTS (SELECT 1 FROM friend_invites
        WHERE friend_id = ? AND rewarded_at IS NOT NULL) AS was_invited
  `).bind(userId, userId, userId, userId).first();
  const pageLimit = pickLimit(row.page_limit, parseSiteDefault(env.DEFAULT_PAGE_LIMIT));
  return {
    pageLimit: addInviteBonus(env, pageLimit, row),
    peopleLimit: pickLimit(row.people_limit, parseSiteDefault(env.DEFAULT_PEOPLE_LIMIT)),
  };
}

export function isAtLimit(count, limit) {
  return limit !== null && count >= limit;
}
