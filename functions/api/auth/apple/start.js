// GET /api/auth/apple/start
//
// Sign in with Apple, for the website. Sends the person to Apple's page; Apple
// posts them back to the callback. Off, with a 404, until the website's
// Services ID is set.

import { isAppleWebConfigured } from '../../../_apple.js';
import { appendAppleCookies, appleReturnUrl } from '../../../_apple-web.js';
import { randomHex, sha256Hex } from '../../../_shared.js';

const AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';
const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;
const STATE_BYTES = 16;
const NONCE_BYTES = 32;
const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;
// Apple only hands over a name or an address when the answer comes as a form.
const SCOPE = 'name email';
const RESPONSE_MODE = 'form_post';

export async function onRequestGet({ request, env }) {
  if (!isAppleWebConfigured(env)) return new Response(null, { status: HTTP_NOT_FOUND });

  const state = randomHex(STATE_BYTES);
  // Apple puts the hash in the identity token; the cookie keeps the original,
  // so a token minted for another sign-in will not match.
  const nonce = randomHex(NONCE_BYTES);
  const params = new URLSearchParams({
    client_id: env.APPLE_WEB_CLIENT_ID,
    redirect_uri: appleReturnUrl(request.url),
    response_type: 'code',
    response_mode: RESPONSE_MODE,
    scope: SCOPE,
    state,
    nonce: await sha256Hex(nonce),
  });

  const headers = new Headers({ Location: `${AUTHORIZE_URL}?${params}` });
  appendAppleCookies(headers, { state, nonce, maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS });
  return new Response(null, { status: HTTP_FOUND, headers });
}
