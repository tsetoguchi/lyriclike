// POST /api/auth/apple/callback (a form Apple posts: code, state, user?, error?)
//
// Sign in with Apple, for the website. Apple sends the person back here with a
// one-time code. The code is traded for an identity token, and a good token
// signs the person in with a session cookie, as the Google sign-in does.

import {
  appleProfile, exchangeWebCode, isAppleWebConfigured, verifyIdentityToken,
} from '../../../_apple.js';
import { saveAppleGrant } from '../../../_apple-grants.js';
import {
  NONCE_COOKIE, STATE_COOKIE, appleReturnUrl, clearAppleCookies,
} from '../../../_apple-web.js';
import { resolveOauthUser } from '../../../_oauth-accounts.js';
import { MINUTE_MS, checkRateLimit, clientIpKey, rateLimitedResponse } from '../../../_ratelimit.js';
import { runInBackground } from '../../../_request.js';
import {
  SESSION_COOKIE_MAX_AGE, createSession, parseCookies, sessionCookie, writeLog,
} from '../../../_shared.js';

const PROVIDER = 'apple';
const HOME_PATH = '/';
const HTTP_SEE_OTHER = 303;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;
const SIGN_INS_PER_WINDOW = 20;
const SIGN_IN_WINDOW_MS = 15 * MINUTE_MS;
const MAX_CODE_LENGTH = 1024;
const MAX_USER_FIELD_LENGTH = 2000;
const MAX_NAME_LENGTH = 80;

const NOT_VERIFIED = 'Apple sign-in could not be verified. Please try again.';
const NO_EMAIL = 'Apple did not share an email address, so an account could not be made. ' +
  'Sign in another way, or allow sharing your email and try again.';

// A bare status would look like a bug in the site.
function problemPage(status, message) {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  clearAppleCookies(headers);
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
    `<title>Sign-in problem</title><p>${message}</p><p><a href="/">Back to LyricLike</a></p>`;
  return new Response(html, { status, headers });
}

// 303, so the browser follows the form POST with a GET.
function backHome(setCookie) {
  const headers = new Headers({ Location: HOME_PATH });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  clearAppleCookies(headers);
  return new Response(null, { status: HTTP_SEE_OTHER, headers });
}

async function readForm(request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function shortText(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_NAME_LENGTH) : '';
}

// Apple sends the name once, on the first sign-in, as JSON in a form field.
function nameFrom(userField) {
  if (typeof userField !== 'string' || userField.length > MAX_USER_FIELD_LENGTH) return null;
  try {
    const { name } = JSON.parse(userField);
    const parts = name ? [shortText(name.firstName), shortText(name.lastName)] : [];
    return parts.filter(Boolean).join(' ') || null;
  } catch {
    return null;
  }
}

// The one-time code, when the form belongs to the sign-in this browser began.
function codeFrom(form, cookies) {
  const code = form.get('code');
  const state = form.get('state');
  const isOurs = Boolean(state) && state === cookies[STATE_COOKIE] && Boolean(cookies[NONCE_COOKIE]);
  const isCode = typeof code === 'string' && code.length > 0 && code.length <= MAX_CODE_LENGTH;
  return isOurs && isCode ? code : null;
}

// Apple's claims about who signed in, plus the refresh token, or null.
async function readAppleAnswer(env, request, code, rawNonce) {
  const tokens = await exchangeWebCode(env, code, appleReturnUrl(request.url));
  if (!tokens) return null;
  const { claims } = await verifyIdentityToken(
    env, tokens.idToken, rawNonce, Date.now(), env.APPLE_WEB_CLIENT_ID);
  return claims ? { claims, refreshToken: tokens.refreshToken } : null;
}

async function refuse(env, request) {
  await writeLog(env, request, { userId: null, event: 'apple_web_sign_in_rejected' });
  return problemPage(HTTP_BAD_GATEWAY, NOT_VERIFIED);
}

async function signedInAnswer(env, request, userId) {
  const sessionToken = await createSession(env, userId);
  return backHome(
    sessionCookie(sessionToken, new URL(request.url), { maxAge: SESSION_COOKIE_MAX_AGE }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAppleWebConfigured(env)) return new Response(null, { status: HTTP_NOT_FOUND });

  const form = await readForm(request);
  if (!form) return new Response('Invalid request', { status: HTTP_BAD_REQUEST });
  // The person pressed Cancel on Apple's page.
  if (form.get('error')) return backHome(null);

  const cookies = parseCookies(request);
  const code = codeFrom(form, cookies);
  if (!code) return new Response('Invalid state', { status: HTTP_BAD_REQUEST });

  const limit = await checkRateLimit(
    env, `apple:ip:${clientIpKey(request)}`, SIGN_INS_PER_WINDOW, SIGN_IN_WINDOW_MS);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  const answer = await readAppleAnswer(env, request, code, cookies[NONCE_COOKIE]);
  if (!answer) return refuse(env, request);

  const profile = appleProfile(answer.claims, nameFrom(form.get('user')));
  const userId = await resolveOauthUser(context, PROVIDER, profile, answer.claims.sub);
  if (!userId) return problemPage(HTTP_FORBIDDEN, NO_EMAIL);

  if (answer.refreshToken) {
    runInBackground(context, 'apple grant', () =>
      saveAppleGrant(env, userId, answer.refreshToken, env.APPLE_WEB_CLIENT_ID));
  }
  return signedInAnswer(env, request, userId);
}
