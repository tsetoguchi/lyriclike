import { describeAccount } from '../_accounts.js';
import { DAY_MS } from '../_ratelimit.js';
import { parseCookies, requireUser, sessionCookie } from '../_shared.js';

const NINETY_DAYS_MS = 90 * DAY_MS;

export async function onRequestGet({ request, env, waitUntil }) {
  // The page calls this on every load, so it is where a session that is close
  // to running out gets its cookie renewed.
  const { user, cookieMaxAge, response } = await requireUser(request, env, { refresh: true });
  if (response) return response;

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

  const headers = new Headers();
  if (cookieMaxAge !== null) {
    const { sid } = parseCookies(request);
    headers.append('Set-Cookie', sessionCookie(sid, new URL(request.url), { maxAge: cookieMaxAge }));
  }
  const account = await describeAccount(env, user.id);
  if (!account) return new Response(null, { status: 401 });
  return Response.json(account, { headers });
}
