// Fixed-window counters in D1. They slow attempts down and never lock an
// account: a lockout would let anyone shut a known user out.

import { jsonError, rateLimitIp, sha256Hex } from './_shared.js';

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const UNKNOWN_IP = 'unknown';
const MS_PER_SECOND = 1000;
const HTTP_TOO_MANY_REQUESTS = 429;

export function clientIpKey(request) {
  return rateLimitIp(request.headers.get('CF-Connecting-IP')) || UNKNOWN_IP;
}

// Keys for one address carry a hash, so this table is not a second store of
// email addresses.
export function addressKey(emailNormalized) {
  return sha256Hex(emailNormalized);
}

function retryAfterSeconds(windowStart, windowMs, now) {
  return Math.max(1, Math.ceil((windowStart + windowMs - now) / MS_PER_SECOND));
}

// One atomic statement: start a new window when the old one has run out,
// otherwise add one. Returns the count and when the window began.
export async function hitRateLimit(env, key, windowMs, now = Date.now()) {
  if (typeof key !== 'string' || !key) throw new TypeError('key must be a non-empty string');
  const cutoff = now - windowMs;
  const row = await env.lyricalmiracle_db.prepare(`
    INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END
    RETURNING count, window_start
  `).bind(key, now, cutoff, cutoff, now).first();
  return { count: row.count, windowStart: row.window_start };
}

// Counts this call, and says whether it is within `limit` for the window.
export async function checkRateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const { count, windowStart } = await hitRateLimit(env, key, windowMs, now);
  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: retryAfterSeconds(windowStart, windowMs, now) };
}

// Reads without counting: for limits that count failures, checked before the
// attempt and bumped with hitRateLimit only if it fails.
export async function peekRateLimit(env, key, limit, windowMs) {
  const now = Date.now();
  const row = await env.lyricalmiracle_db.prepare(
    'SELECT count, window_start FROM rate_limits WHERE key = ?'
  ).bind(key).first();

  const live = row && row.window_start >= now - windowMs;
  if (!live || row.count < limit) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: retryAfterSeconds(row.window_start, windowMs, now) };
}

export function rateLimitedResponse(retryAfter) {
  return jsonError(HTTP_TOO_MANY_REQUESTS, 'rate_limited',
    'Too many attempts. Try again later.', { 'Retry-After': String(retryAfter) });
}
