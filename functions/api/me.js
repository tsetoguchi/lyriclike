import { describeAccount, extensionScriptUrl } from '../_accounts.js';
import { isEventHookSet } from '../_event-hook.js';
import { sendParkedEvents } from '../_event-resend.js';
import { DAY_MS } from '../_ratelimit.js';
import { parseCookies, requireUser, sessionCookie, truncateIp, writeLog } from '../_shared.js';

const NINETY_DAYS_MS = 90 * DAY_MS;
const EVENT_HOOK_DROPPED = 'event_hook_dropped';
const APP_OPEN = 'app_open';
const HTTP_UNAUTHORIZED = 401;

// Signed out, the site's extension script still runs, so its path comes back
// with the 401.
function signedOut(env) {
  return Response.json(
    { extension_script_url: extensionScriptUrl(env) }, { status: HTTP_UNAUTHORIZED }
  );
}

// One row per person per UTC day, so return visits can be counted even when
// nothing gets saved. The check and the insert are one statement, so two tabs
// loading at once still leave one row.
function logDailyVisit(env, request, userId, now) {
  const dayStart = now - (now % DAY_MS);
  const ip = truncateIp(request.headers.get('CF-Connecting-IP'));
  return env.lyricalmiracle_db.prepare(
    'INSERT INTO logs (id, user_id, event, ip, created_at) SELECT ?, ?, ?, ?, ? ' +
    'WHERE NOT EXISTS (SELECT 1 FROM logs WHERE user_id = ? AND event = ? AND created_at >= ?)'
  ).bind(crypto.randomUUID(), userId, APP_OPEN, ip, now, userId, APP_OPEN, dayStart).run();
}

export async function onRequestGet({ request, env, waitUntil }) {
  // The page calls this on every load, so it is where a session that is close
  // to running out gets its cookie renewed.
  const { user, cookieMaxAge, response } = await requireUser(request, env, { refresh: true });
  if (response) return signedOut(env);

  // Clean up expired rows and old logs in the background. Rate-limit counters
  // are kept for the longest window (one day), so a daily counter is not reset
  // early.
  const now = Date.now();
  waitUntil(env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.lyricalmiracle_db.prepare('DELETE FROM logs WHERE created_at < ?').bind(now - NINETY_DAYS_MS),
    env.lyricalmiracle_db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?').bind(now),
    env.lyricalmiracle_db.prepare('DELETE FROM pending_signups WHERE expires_at < ?').bind(now),
    env.lyricalmiracle_db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(now - DAY_MS),
  ]));
  waitUntil(logDailyVisit(env, request, user.id, now));
  if (isEventHookSet(env)) {
    const onDropped = () => writeLog(env, request, { userId: null, event: EVENT_HOOK_DROPPED });
    waitUntil(sendParkedEvents(env, { onDropped }));
  }

  const headers = new Headers();
  if (cookieMaxAge !== null) {
    const { sid } = parseCookies(request);
    headers.append('Set-Cookie', sessionCookie(sid, new URL(request.url), { maxAge: cookieMaxAge }));
  }
  const account = await describeAccount(env, user.id);
  if (!account) return signedOut(env);
  return Response.json(account, { headers });
}
