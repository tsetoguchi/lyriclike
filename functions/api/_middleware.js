// Everything that applies to every answer under /api lives here.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_MEDIA_TYPE = 'application/json';

const HTTP_FORBIDDEN = 403;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_SERVER_ERROR = 500;

// SameSite=Lax is the first layer against forged requests; this is the second.
// Browsers send Origin on every non-GET request, and Sec-Fetch-Site covers the
// rare one that does not.
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

function rejectForgedRequest(request) {
  if (SAFE_METHODS.has(request.method)) return null;
  if (!isSameOrigin(request)) return new Response(null, { status: HTTP_FORBIDDEN });
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
  const response = rejectForgedRequest(context.request) || await runRoute(context);

  const answer = new Response(response.body, response);
  // _headers does not apply to Function responses.
  answer.headers.set('X-Content-Type-Options', 'nosniff');

  // A route that has already said how it may be cached knows its own business:
  // the definition proxy caches at the edge on purpose, and asks nobody.
  if (!answer.headers.has('Cache-Control')) {
    answer.headers.set('Cache-Control', 'private, no-store');
    answer.headers.set('Vary', 'Cookie');
  }
  return answer;
}
