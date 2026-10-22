// Per-account limits on pages and on people per page. A site sets defaults in
// its settings; a user_limits row overrides them for one account. With no
// settings at all (a self-hosted copy) nothing is limited.

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

export async function findLimits(env, userId) {
  const row = await env.lyricalmiracle_db.prepare(
    'SELECT page_limit, people_limit FROM user_limits WHERE user_id = ?'
  ).bind(userId).first();
  return {
    pageLimit: pickLimit(row && row.page_limit, parseSiteDefault(env.DEFAULT_PAGE_LIMIT)),
    peopleLimit: pickLimit(row && row.people_limit, parseSiteDefault(env.DEFAULT_PEOPLE_LIMIT)),
  };
}

export function isAtLimit(count, limit) {
  return limit !== null && count >= limit;
}
