import {
  base64Url, cookieHeader, randomHex, sha256Bytes,
} from '../../../_shared.js';

const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;
const PKCE_VERIFIER_BYTES = 32;

export async function onRequestGet({ request, env }) {
  const state = randomHex(16);
  const url = new URL(request.url);

  // PKCE: Google sees only the hash of the verifier now, and the verifier
  // itself at the token exchange. A stolen authorization code is useless
  // without the cookie that only this browser holds.
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(PKCE_VERIFIER_BYTES)));
  const challenge = base64Url(await sha256Bytes(verifier));

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const headers = new Headers({
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
  const maxAge = OAUTH_COOKIE_MAX_AGE_SECONDS;
  headers.append('Set-Cookie', cookieHeader('oauth_state', state, url, { maxAge }));
  headers.append('Set-Cookie', cookieHeader('oauth_verifier', verifier, url, { maxAge }));

  return new Response(null, { status: 302, headers });
}
