// Cloudflare Turnstile, the CAPTCHA on signup, forgot-password and challenged
// logins. The widget belongs to one form, so the response must name that form.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 3000;
const MAX_TOKEN_LENGTH = 2048;

export const TURNSTILE_ACTION = Object.freeze({
  SIGNUP: 'signup',
  FORGOT: 'forgot',
  LOGIN: 'login',
});

function expectedHostname(env) {
  try {
    return new URL(env.APP_BASE_URL).hostname;
  } catch {
    return null;
  }
}

// True only when Cloudflare says the token is good, was issued for this site's
// hostname, and was issued for this form. Anything else, including a missing
// secret or a network failure, is a refusal: a CAPTCHA that fails open is none.
export async function verifyTurnstile(token, request, env, action) {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return false;
  const hostname = expectedHostname(env);
  if (!env.TURNSTILE_SECRET_KEY || !hostname) return false;

  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.hostname === hostname && result.action === action;
  } catch {
    return false;
  }
}
