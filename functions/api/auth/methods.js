import { isAppleConfigured } from '../../_apple.js';
import { passwordAuthEnabled } from '../../_request.js';

// Tells the sign-in modal what to offer. Always answers, even with the flag
// off: that is how the modal learns to show only Google. The Turnstile site
// key is public, but each environment has its own site (production and the
// preview alias), so it comes from here rather than from the static HTML.
// `apple` says Sign in with Apple is set up; only the iOS app offers it.
export function onRequestGet({ env }) {
  return Response.json({
    password: passwordAuthEnabled(env),
    apple: isAppleConfigured(env),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  });
}
