// Everything that applies to every answer under /api lives here.

import { hasBearerToken, isAppClient } from '../_shared.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_MEDIA_TYPE = 'application/json';

const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_SERVER_ERROR = 500;

// Where the iOS and Android apps load their bundled pages from. They are the
// only other origins allowed to call the API, and only with a Bearer token:
// no cookie travels with those calls, so there is nothing for a forged request
// to ride on.
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost']);
const APP_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const APP_ALLOWED_HEADERS = 'Authorization, Content-Type, X-LyricLike-Client';
const PREFLIGHT_MAX_AGE_SECONDS = '86400';

function appOrigin(request) {
  const origin = request.headers.get('Origin');
  return APP_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': APP_ALLOWED_METHODS,
    'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
    'Access-Control-Max-Age': PREFLIGHT_MAX_AGE_SECONDS,
    Vary: 'Origin',
  };
}

function answerPreflight(request) {
  if (request.method !== 'OPTIONS') return null;
  const origin = appOrigin(request);
  if (!origin) return new Response(null, { status: HTTP_FORBIDDEN });
  return new Response(null, { status: HTTP_NO_CONTENT, headers: corsHeaders(origin) });
}

// SameSite=Lax is the first layer against forged requests; this is the second.
// Browsers send Origin on every non-GET request, and Sec-Fetch-Site covers the
// rare one that does not.
// Either the app's own origin with its marker header (sign-in, before any
// token exists) or a Bearer token. A page on another site can send neither:
// the browser would first ask permission, and only the app origins get a yes.
function isAppRequest(request) {
  return hasBearerToken(request) || (appOrigin(request) !== null && isAppClient(request));
}

function addAppCors(answer, request) {
  const origin = appOrigin(request);
  if (!origin) return;
  const { Vary: vary, ...headers } = corsHeaders(origin);
  for (const [name, value] of Object.entries(headers)) answer.headers.set(name, value);
  answer.headers.append('Vary', vary);
}

function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

// A body with any other type is how a cross-site HTML form would try to reach
// a JSON route. A request with no body needs no type: the body-less DELETEs
// (a lyric, the account) and the sign-out POST must keep working.
function hasBody(request) {
  return request.body !== null && request.headers.get('Content-Length') !== '0';
}

function isJson(request) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  return type === JSON_MEDIA_TYPE;
}

// The one exception: a mail app's one-click unsubscribe is a cross-site POST
// with a form body. The route needs no cookie; its signed token is the only
// thing that lets it act, so a forged request can do nothing with it.
const ONE_CLICK_STOP_PATH = '/api/invites/stop';

function isOneClickStop(request) {
  return request.method === 'POST' && new URL(request.url).pathname === ONE_CLICK_STOP_PATH;
}

function rejectForgedRequest(request) {
  if (SAFE_METHODS.has(request.method)) return null;
  if (isOneClickStop(request)) return null;
  if (!isAppRequest(request) && !isSameOrigin(request)) {
    return new Response(null, { status: HTTP_FORBIDDEN });
  }
  if (hasBody(request) && !isJson(request)) {
    return new Response(null, { status: HTTP_UNSUPPORTED_MEDIA_TYPE });
  }
  return null;
}

// A thrown error would otherwise reach the client as a stack trace or a SQL
// message. Cloudflare's own log still records it.
async function runRoute(context) {
  try {
    return await context.next();
  } catch (err) {
    console.error('api error', err);
    return new Response(null, { status: HTTP_SERVER_ERROR });
  }
}

// Every answer under /api depends on who is asking: the session cookie decides
// whether it is a lyric or a 401. Cloudflare's default of "public, max-age=0"
// with no Vary lets a signed-out 401 be held and handed back after signing in,
// which reads as the sign-in having failed.
export async function onRequest(context) {
  const preflight = answerPreflight(context.request);
  if (preflight) return preflight;

  const response = rejectForgedRequest(context.request) || await runRoute(context);
  // Rebuilding a 101 would drop its webSocket, so the handoff goes out untouched.
  if (response.status === 101) return response;

  const answer = new Response(response.body, response);
  // _headers does not apply to Function responses.
  answer.headers.set('X-Content-Type-Options', 'nosniff');
  addAppCors(answer, context.request);

  // A route that has already said how it may be cached knows its own business:
  // the definition proxy caches at the edge on purpose, and asks nobody.
  if (!answer.headers.has('Cache-Control')) {
    answer.headers.set('Cache-Control', 'private, no-store');
    answer.headers.append('Vary', 'Cookie');
  }
  return answer;
}
