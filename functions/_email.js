// Transactional email through Resend. Every emailed link is built from
// APP_BASE_URL, never from the Host header, which blocks reset-link poisoning.
// Tokens ride in the URL fragment, so they never reach request logs.

import { DAY_MS, checkRateLimit } from './_ratelimit.js';
import { sha256Hex, writeLog } from './_shared.js';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 5000;

export const SIGNUP_LINK_HOURS = 24;
export const RESET_LINK_MINUTES = 30;

// Mail per address per day, and a daily budget kept under Resend's free cap.
// Signup mail has its own pool, so abuse that gets past Turnstile cannot use
// up the quota that reset mail depends on.
const ADDRESS_DAILY_LIMIT = 5;
export const EMAIL_POOL = Object.freeze({ SIGNUP: 'signup', ACCOUNT: 'account' });
const POOL_DAILY_LIMIT = Object.freeze({ signup: 60, account: 30 });

const AMBER = '#e9b45f';
const INK = '#141922';
const FADED_INK = '#5b6270';
const PAGE_BACKGROUND = '#f4f1ea';

// The app's own type: Montserrat Bold for headings, iA Writer Quattro for the
// rest, with the same fallbacks as --font-display and --font-editor (minus
// system-ui, which mail clients do not know). Clients that load web fonts
// (Apple Mail, iOS Mail, Thunderbird) fetch the self-hosted files below; Gmail
// and Outlook ignore @font-face and use the fallbacks.
const FONT_DISPLAY = "'Montserrat', 'Futura', 'Trebuchet MS', 'Segoe UI', Arial, sans-serif";
const FONT_BODY = "'iA Writer Quattro', -apple-system, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

// Same-size box as the wordmark's 267x84 file, drawn for a light background:
// the header wordmark's pale lettering would vanish on it.
const LOGO_PATH = 'assets/wordmark-light.png';
const LOGO_WIDTH = 102;
const LOGO_HEIGHT = 32;

const FONT_FACES = [
  ['iA Writer Quattro', 400, 'normal', 'iAWriterQuattroS-Regular'],
  ['iA Writer Quattro', 400, 'italic', 'iAWriterQuattroS-Italic'],
  ['iA Writer Quattro', 700, 'normal', 'iAWriterQuattroS-Bold'],
  ['Montserrat', 700, 'normal', 'Montserrat-Bold'],
];

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function baseUrl(env) {
  if (!env.APP_BASE_URL) throw new Error('APP_BASE_URL is not set');
  return env.APP_BASE_URL.replace(/\/+$/, '');
}

function linkTo(env, key, token) {
  return token ? `${baseUrl(env)}/#${key}=${token}` : baseUrl(env) + '/';
}

function fontFaceRules(env) {
  return FONT_FACES.map(([family, weight, style, file]) =>
    `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};` +
    `src:url('${baseUrl(env)}/fonts/${file}.woff2') format('woff2');}`).join('\n');
}

// A light template, since many mail clients invert or strip dark styles. One
// button, in amber with dark text because white on amber fails contrast.
function renderEmail(env, { heading, paragraphs, button, footer }) {
  const text = [heading, '', ...paragraphs, '', `${button.label}: ${button.url}`, '', footer]
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${fontFaceRules(env)}
</style></head>
<body style="margin:0;background:${PAGE_BACKGROUND};">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:${FONT_BODY};color:${INK};">
<p style="margin:0 0 28px;"><a href="${escapeHtml(baseUrl(env))}/" style="text-decoration:none;"><img src="${escapeHtml(baseUrl(env))}/${LOGO_PATH}" alt="LyricLike" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="display:block;border:0;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;font-family:${FONT_DISPLAY};font-weight:700;font-size:20px;color:${INK};"></a></p>
<h1 style="font-family:${FONT_DISPLAY};font-weight:700;font-size:20px;line-height:1.3;margin:0 0 16px;">${escapeHtml(heading)}</h1>
${paragraphs.map(p => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px;">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 20px;background:${AMBER};color:${INK};text-decoration:none;border-radius:6px;font-family:${FONT_BODY};font-weight:700;font-size:15px;">${escapeHtml(button.label)}</a></p>
<p style="font-family:${FONT_BODY};font-style:italic;font-size:13px;line-height:1.5;color:${FADED_INK};margin:0;">${escapeHtml(footer)}</p>
</div></body></html>`;
  return { text, html };
}

function confirmSignupMessage(env, token) {
  return {
    subject: 'Confirm your email for LyricLike',
    ...renderEmail(env, {
      heading: 'Confirm your email',
      paragraphs: [
        'Open the link and enter the password you chose to finish creating your account.',
        `The link works for ${SIGNUP_LINK_HOURS} hours.`,
      ],
      button: { label: 'Confirm email', url: linkTo(env, 'signup_token', token) },
      footer: "If you didn't sign up, ignore this email. Nothing is created until you confirm.",
    }),
  };
}

function existingAccountMessage(env) {
  return {
    subject: 'You already have a LyricLike account',
    ...renderEmail(env, {
      heading: 'You already have an account',
      paragraphs: [
        'Someone, hopefully you, tried to create a LyricLike account with this address, ' +
          'but one already exists.',
        'Sign in, or use "Forgot password" on the sign-in form if you need to set a new password.',
      ],
      button: { label: 'Go to LyricLike', url: linkTo(env) },
      footer: "If this wasn't you, you can ignore this email. Your account is unchanged.",
    }),
  };
}

function resetMessage(env, token) {
  return {
    subject: 'Reset your LyricLike password',
    ...renderEmail(env, {
      heading: 'Reset your password',
      paragraphs: [
        'Open the link to choose a new password.',
        `The link works for ${RESET_LINK_MINUTES} minutes and can be used once.`,
      ],
      button: { label: 'Set a new password', url: linkTo(env, 'reset_token', token) },
      footer: "If you didn't ask for this, ignore this email. Your password stays as it is.",
    }),
  };
}

function passwordChangedMessage(env) {
  return {
    subject: 'Your LyricLike password was changed',
    ...renderEmail(env, {
      heading: 'Your password was changed',
      paragraphs: [
        'The password on your LyricLike account was just set or changed, and any other ' +
          'devices were signed out.',
        "If that was you, there's nothing to do.",
      ],
      button: { label: 'Go to LyricLike', url: linkTo(env) },
      footer: "If it wasn't you, use \"Forgot password\" on the sign-in form right away.",
    }),
  };
}

function googleAddedMessage(env, token) {
  return {
    subject: 'Google sign-in was added to your LyricLike account',
    ...renderEmail(env, {
      heading: 'Google sign-in was added',
      paragraphs: [
        'Someone signed in with Google using this address, so Google sign-in now works ' +
          'on your existing LyricLike account.',
        `If that wasn't you, set a new password now. The link works for ${RESET_LINK_MINUTES} minutes.`,
      ],
      button: { label: 'Set a new password', url: linkTo(env, 'reset_token', token) },
      footer: "If it was you, there's nothing to do.",
    }),
  };
}

// A thin adapter: one fetch. Returns { ok } and never throws.
export async function sendEmail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false };
  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

async function logEmailEvent({ env, request }, event) {
  try {
    await writeLog(env, request, { event });
  } catch (err) {
    console.error('log failed', event, err);
  }
}

// Whether this address and this pool still have room today. The address is
// checked first, so a refused address does not spend the pool's budget.
async function withinEmailLimits(env, pool, to) {
  const perAddress = await checkRateLimit(
    env, `email:addr:${await sha256Hex(to.trim().toLowerCase())}`, ADDRESS_DAILY_LIMIT, DAY_MS);
  if (!perAddress.allowed) return false;
  const perPool = await checkRateLimit(env, `email:pool:${pool}`, POOL_DAILY_LIMIT[pool], DAY_MS);
  return perPool.allowed;
}

// Applies the limits, builds and sends. Returns a promise that never rejects;
// callers hand it to waitUntil so the response neither waits for the provider
// nor reveals how long it took. A skipped or failed send is logged, so a quota
// or DNS problem shows up.
async function deliverEmail(context, pool, to, build) {
  try {
    if (!await withinEmailLimits(context.env, pool, to)) {
      await logEmailEvent(context, 'email_skipped');
      return;
    }
    const message = build(context.env);
    const { ok } = await sendEmail(context.env, { to, ...message });
    if (!ok) await logEmailEvent(context, 'email_failed');
  } catch (err) {
    console.error('email error', err);
    await logEmailEvent(context, 'email_failed');
  }
}

export function sendConfirmSignupEmail(context, { to, token }) {
  return deliverEmail(context, EMAIL_POOL.SIGNUP, to, env => confirmSignupMessage(env, token));
}

export function sendExistingAccountEmail(context, { to }) {
  return deliverEmail(context, EMAIL_POOL.SIGNUP, to, env => existingAccountMessage(env));
}

export function sendResetEmail(context, { to, token }) {
  return deliverEmail(context, EMAIL_POOL.ACCOUNT, to, env => resetMessage(env, token));
}

export function sendPasswordChangedEmail(context, { to }) {
  return deliverEmail(context, EMAIL_POOL.ACCOUNT, to, env => passwordChangedMessage(env));
}

export function sendGoogleAddedEmail(context, { to, token }) {
  return deliverEmail(context, EMAIL_POOL.ACCOUNT, to, env => googleAddedMessage(env, token));
}
