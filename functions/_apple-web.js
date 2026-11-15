// What the two website routes for Sign in with Apple share: where Apple sends
// the person back to, and the cookies that tie the return to this browser.

import { crossSiteCookieHeader } from './_shared.js';

export const STATE_COOKIE = 'apple_oauth_state';
export const NONCE_COOKIE = 'apple_oauth_nonce';
const RETURN_PATH = '/api/auth/apple/callback';

// Must match a Return URL on the Services ID, letter for letter.
export function appleReturnUrl(requestUrl) {
  return new URL(requestUrl).origin + RETURN_PATH;
}

// Apple comes back with a cross-site form POST, which Lax cookies do not ride.
export function appendAppleCookies(headers, { state, nonce, maxAge }) {
  headers.append('Set-Cookie', crossSiteCookieHeader(STATE_COOKIE, state, { maxAge }));
  headers.append('Set-Cookie', crossSiteCookieHeader(NONCE_COOKIE, nonce, { maxAge }));
}

export function clearAppleCookies(headers) {
  appendAppleCookies(headers, { state: '', nonce: '', maxAge: 0 });
}
