import { SIGNIN_TICKET, issueAppTicket } from '../../../_app-tickets.js';
import { resolveOauthUser } from '../../../_oauth-accounts.js';
import {
  SESSION_COOKIE_MAX_AGE, cookieHeader, createSession, normalizeEmail, parseCookies, sessionCookie,
} from '../../../_shared.js';

const PROVIDER = 'google';
const HTTP_FORBIDDEN = 403;
const APP_RETURN_URL = 'lyriclike://auth';

function clearOauthCookies(headers, url) {
  headers.append('Set-Cookie', cookieHeader('oauth_state', '', url, { maxAge: 0 }));
  headers.append('Set-Cookie', cookieHeader('oauth_verifier', '', url, { maxAge: 0 }));
  headers.append('Set-Cookie', cookieHeader('oauth_app_challenge', '', url, { maxAge: 0 }));
}

// The app opened this sign-in in the system browser. A page, not a redirect:
// some in-app browsers refuse to follow a redirect to a custom scheme, and the
// button covers the ones that block the automatic jump.
async function appReturnPage(env, url, userId, challenge) {
  const code = await issueAppTicket(env, { kind: SIGNIN_TICKET, userId, challenge });
  const target = `${APP_RETURN_URL}?code=${code}`;
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  clearOauthCookies(headers, url);
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>Signed in</title>' +
    `<p>You are signed in. <a href="${target}">Return to LyricLike</a></p>` +
    `<script>location.href=${JSON.stringify(target)}</script>`;
  return new Response(html, { status: 200, headers });
}

// Shown when Google will not vouch for the address. A bare 400 would look like
// a bug in the site.
function unverifiedEmailPage(url) {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  clearOauthCookies(headers, url);
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    '<title>Sign-in problem</title>' +
    '<p>Google has not verified the email address on that account, so we can\'t sign you in with it.</p>' +
    '<p><a href="/">Back to LyricLike</a></p>';
  return new Response(html, { status: HTTP_FORBIDDEN, headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request);

  if (!code || !state || state !== cookies.oauth_state || !cookies.oauth_verifier) {
    return new Response('Invalid state', { status: 400 });
  }

  // Exchange the temporary code for an access token.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_REDIRECT_URL,
      code_verifier: cookies.oauth_verifier,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) return new Response('Token exchange failed', { status: 500 });
  const { access_token } = await tokenRes.json();

  // Use the token to fetch the user's Google profile.
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) return new Response('Failed to fetch user info', { status: 500 });
  const { sub, email, email_verified: emailVerified, name } = await userRes.json();

  // Matching an account by address is only safe when Google vouches for it.
  const profile = {
    email, name, emailNormalized: normalizeEmail(email), emailVerified: emailVerified === true,
  };
  const userId = await resolveOauthUser(context, PROVIDER, profile, sub);
  if (!userId) return unverifiedEmailPage(url);

  if (cookies.oauth_app_challenge) {
    return appReturnPage(env, url, userId, cookies.oauth_app_challenge);
  }

  const sessionToken = await createSession(env, userId);

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie',
    sessionCookie(sessionToken, url, { maxAge: SESSION_COOKIE_MAX_AGE }));
  clearOauthCookies(headers, url);

  return new Response(null, { status: 302, headers });
}
