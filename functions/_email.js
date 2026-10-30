// Transactional email through Resend. Every emailed link is built from
// APP_BASE_URL, never from the Host header, which blocks reset-link poisoning.
// Tokens ride in the URL fragment, so they never reach request logs.

import { DAY_MS, checkRateLimit, hitRateLimit, peekRateLimit } from './_ratelimit.js';
import { base64Url, jsonError, sha256Hex, writeLog } from './_shared.js';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 5000;

export const SIGNUP_LINK_HOURS = 24;
export const RESET_LINK_MINUTES = 30;

// Mail per address per day, and a daily budget kept under Resend's free cap
// of 100. Signup, invite and feedback mail each have their own pool, so abuse
// that gets past Turnstile, a burst of shares, or a flood of feedback cannot
// use up the quota that reset mail depends on.
const ADDRESS_DAILY_LIMIT = 5;
export const EMAIL_POOL = Object.freeze({
  SIGNUP: 'signup', ACCOUNT: 'account', INVITE: 'invite', FEEDBACK: 'feedback',
});
export const POOL_DAILY_LIMIT = Object.freeze({ signup: 40, account: 30, invite: 20, feedback: 10 });

// A pool that reaches this share of its cap emails ALERT_EMAIL, so a busy day
// shows up before mail starts being refused.
const ALERT_FRACTION = 0.7;
const RESEND_DASHBOARD_URL = 'https://resend.com/emails';

const HTTP_SERVICE_UNAVAILABLE = 503;
const POOL_FULL_MESSAGE = Object.freeze({
  signup: "We can't send any more sign-up emails today. Try again tomorrow, " +
    'or continue with Google.',
  account: "We can't send any more account emails today. Try again tomorrow.",
});

const AMBER = '#e9b45f';
const INK = '#141922';
const FADED_INK = '#5b6270';
const PAGE_BACKGROUND = '#f4f1ea';

// The app's own type: iA Writer Quattro throughout, bold for headings, with
// the same fallbacks as --font-editor (minus system-ui, which mail clients do
// not know). Clients that load web fonts
// (Apple Mail, iOS Mail, Thunderbird) fetch the self-hosted files below; Gmail
// and Outlook ignore @font-face and use the fallbacks.
const FONT_BODY = "'iA Writer Quattro', -apple-system, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif";

// Same-size box as the wordmark's 295x84 file, drawn for a light background:
// the header wordmark's pale lettering would vanish on it. Gmail's image proxy
// keeps a picture under its URL for good, so bump the version whenever the
// file changes or old inboxes keep the old logo.
const LOGO_PATH = 'assets/wordmark-light.png?v=2';
const LOGO_WIDTH = 112;
const LOGO_HEIGHT = 32;

const FONT_FACES = [
  ['iA Writer Quattro', 400, 'normal', 'iAWriterQuattroS-Regular'],
  ['iA Writer Quattro', 400, 'italic', 'iAWriterQuattroS-Italic'],
  ['iA Writer Quattro', 700, 'normal', 'iAWriterQuattroS-Bold'],
];

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function baseUrl(env) {
  if (!env.APP_BASE_URL) throw new Error('APP_BASE_URL is not set');
  return env.APP_BASE_URL.replace(/\/+$/, '');
}

// `more` adds further key=value pairs after the first, joined with '&'.
function linkTo(env, key, token, more = '') {
  if (!token) return baseUrl(env) + '/';
  return `${baseUrl(env)}/#${key}=${token}` + (more ? `&${more}` : '');
}

function fontFaceRules(env) {
  return FONT_FACES.map(([family, weight, style, file]) =>
    `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};` +
    `src:url('${baseUrl(env)}/fonts/${file}.woff2') format('woff2');}`).join('\n');
}

// A light template, since many mail clients invert or strip dark styles. One
// button, in amber with dark text because white on amber fails contrast. An
// optional footer link (the invite's stop link) goes in both parts.
function renderEmail(env, { heading, paragraphs, button, footer, footerLink }) {
  const footerText = footerLink ? `${footer} ${footerLink.label}: ${footerLink.url}` : footer;
  const footerHtml = escapeHtml(footer) + (footerLink
    ? ` <a href="${escapeHtml(footerLink.url)}" style="color:${FADED_INK};">${escapeHtml(footerLink.label)}</a>`
    : '');
  const text = [heading, '', ...paragraphs, '', `${button.label}: ${button.url}`, '', footerText]
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${fontFaceRules(env)}
</style></head>
<body style="margin:0;background:${PAGE_BACKGROUND};">
<div style="max-width:480px;margin:0 auto;padding:32px 24px;font-family:${FONT_BODY};color:${INK};">
<p style="margin:0 0 28px;"><a href="${escapeHtml(baseUrl(env))}/" style="text-decoration:none;"><img src="${escapeHtml(baseUrl(env))}/${LOGO_PATH}" alt="LyricLike" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" style="display:block;border:0;width:${LOGO_WIDTH}px;height:${LOGO_HEIGHT}px;font-family:${FONT_BODY};font-weight:700;font-size:20px;color:${INK};"></a></p>
<h1 style="font-family:${FONT_BODY};font-weight:700;font-size:20px;line-height:1.3;margin:0 0 16px;">${escapeHtml(heading)}</h1>
${paragraphs.map(p => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px;">${escapeHtml(p)}</p>`).join('\n')}
<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 20px;background:${AMBER};color:${INK};text-decoration:none;border-radius:6px;font-family:${FONT_BODY};font-weight:700;font-size:15px;">${escapeHtml(button.label)}</a></p>
<p style="font-family:${FONT_BODY};font-style:italic;font-size:13px;line-height:1.5;color:${FADED_INK};margin:0;">${footerHtml}</p>
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

function setPasswordMessage(env, token) {
  return {
    subject: 'Add a password to your LyricLike account',
    ...renderEmail(env, {
      heading: 'Add a password',
      paragraphs: [
        'Open the link to choose a password. You can then sign in with your email and ' +
          'password, as well as with Google.',
        `The link works for ${RESET_LINK_MINUTES} minutes and can be used once.`,
      ],
      button: { label: 'Choose a password', url: linkTo(env, 'reset_token', token) },
      footer: "If you didn't ask for this, ignore this email. Your account stays as it is.",
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

// ── Invites ──

export const INVITE_SENDER_DAILY_LIMIT = 5;
export const INVITE_ADDRESS_DAILY_LIMIT = 2;
const INVITE_TITLE_MAX = 60;
const INVITE_NAME_MAX = 40;
const STOP_LINK_LABEL = 'Stop emails like this.';

// The stop token is "{hash}.{hmac}": the sha256 of the address, signed with
// INVITE_SIGNING_SECRET. It never holds the address, so the one-click URL
// keeps it out of request logs, and nobody can stop mail to someone else.
async function signingKey(env) {
  if (!env.INVITE_SIGNING_SECRET) throw new Error('INVITE_SIGNING_SECRET is not set');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.INVITE_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function inviteStopToken(env, emailNormalized) {
  const hash = await sha256Hex(emailNormalized);
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), new TextEncoder().encode(hash));
  return `${hash}.${base64Url(new Uint8Array(signature))}`;
}

function fromBase64Url(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

// Returns the address hash a valid token carries, or null. The compare is
// crypto.subtle.verify, which takes the same time however much matches.
export async function verifyStopToken(env, token) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const match = /^([0-9a-f]{64})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await signingKey(env), fromBase64Url(match[2]),
      new TextEncoder().encode(match[1]));
    return ok ? match[1] : null;
  } catch {
    return null;
  }
}

// Anyone picks their own name and page title, and both go in a subject line.
// One line each, and short, so neither can pass for a message.
function oneLine(text, max) {
  const flat = String(text).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
}

export function inviteSenderName(user) {
  return oneLine(user.name || '', INVITE_NAME_MAX) || user.email;
}

// The invited address rides in the link, so the sign-in box can start with
// it: the page opens only for the account with that address.
function inviteMessage(env, { to, senderName, title, lyricId, hasAccount, stopUrl }) {
  const sender = oneLine(senderName, INVITE_NAME_MAX);
  const pageTitle = oneLine(title, INVITE_TITLE_MAX) || 'Untitled';
  const stopLink = { label: STOP_LINK_LABEL, url: stopUrl };
  const invited = `to=${encodeURIComponent(to.trim())}`;
  const content = hasAccount
    ? {
      heading: `${sender} shared a page with you`,
      paragraphs: [`${sender} shared “${pageTitle}” with you on LyricLike. You can read it and edit it.`],
      button: { label: 'Open the page', url: linkTo(env, 'shared', lyricId, invited) },
      footer: `You got this because ${sender} shared a page with this address.`,
    }
    : {
      heading: `${sender} shared a page with you`,
      paragraphs: [
        `${sender} is writing on LyricLike and wants you in on “${pageTitle}”.`,
        'Create a free account with this email to read it and write with them.',
      ],
      button: { label: 'Sign up to see it', url: linkTo(env, 'shared', lyricId, `signup=1&${invited}`) },
      footer: 'Not interested?',
    };
  return {
    subject: `${sender} shared "${pageTitle}" with you`,
    ...renderEmail(env, { ...content, footerLink: stopLink }),
  };
}

// Invite limits are checked by the share route before it answers, so the
// sender can be told when no mail went. This builds, sends and, from
// `poolCount`, warns the owner when the pool is filling. Both mail apps'
// one-click unsubscribe and the footer link reach the stop route.
export async function sendInviteEmail(
  context, { to, senderName, title, lyricId, hasAccount, poolCount }) {
  try {
    const { env } = context;
    const token = await inviteStopToken(env, to.trim().toLowerCase());
    const oneClickUrl = `${baseUrl(env)}/api/invites/stop?token=${token}`;
    const message = inviteMessage(env, {
      to, senderName, title, lyricId, hasAccount, stopUrl: linkTo(env, 'stop_token', token),
    });
    const headers = {
      'List-Unsubscribe': `<${oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
    const { ok } = await sendEmail(env, { to, ...message, headers });
    if (!ok) await logEmailEvent(context, 'email_failed');
    await warnIfPoolFilling(context, EMAIL_POOL.INVITE, poolCount);
  } catch (err) {
    console.error('invite email error', err);
    await logEmailEvent(context, 'email_failed');
  }
}

function quotaWarningMessage(env, pool, count) {
  const limit = POOL_DAILY_LIMIT[pool];
  return {
    subject: `LyricLike ${pool} email is at ${count} of ${limit} today`,
    ...renderEmail(env, {
      heading: `Today's ${pool} email is filling up`,
      paragraphs: [
        `${count} of today's ${limit} ${pool} emails have been used. At ${limit}, ` +
          'people are told to try again tomorrow.',
        'If this keeps happening, upgrade the Resend plan and raise POOL_DAILY_LIMIT ' +
          'in functions/_email.js.',
      ],
      button: { label: 'Open Resend', url: RESEND_DASHBOARD_URL },
      footer: 'Sent at most once a day per pool, because ALERT_EMAIL is set.',
    }),
  };
}

// A thin adapter: one fetch. Returns { ok } and never throws. `headers` are
// extra mail headers, such as List-Unsubscribe.
export async function sendEmail(env, { to, subject, text, html, headers, replyTo }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false };
  const message = { from: env.EMAIL_FROM, to: [to], subject, text, html };
  if (headers) message.headers = headers;
  if (replyTo) message.reply_to = replyTo;
  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
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

// The event logged when a mail is skipped. The reason goes in the name,
// because the logs table has no room for more: a full pool is the one to act
// on, a busy address is normal.
export function emailSkippedEvent(reason, pool) {
  return reason === 'pool' ? `email_skipped_pool_${pool}` : 'email_skipped_address';
}

// Counts this send against the address and the pool. Returns { count }, the
// pool's count so far today, or { skipped } naming which one is out of room.
// The address is checked first, so a refused address does not spend the
// pool's budget.
async function claimEmailSlot(env, pool, to) {
  const perAddress = await checkRateLimit(
    env, `email:addr:${await sha256Hex(to.trim().toLowerCase())}`, ADDRESS_DAILY_LIMIT, DAY_MS);
  if (!perAddress.allowed) return { skipped: 'address' };
  const { count } = await hitRateLimit(env, `email:pool:${pool}`, DAY_MS);
  return count <= POOL_DAILY_LIMIT[pool] ? { count } : { skipped: 'pool' };
}

function alertThreshold(pool) {
  return Math.ceil(POOL_DAILY_LIMIT[pool] * ALERT_FRACTION);
}

// The pool counter is atomic, so exactly one send a day lands on the
// threshold: the warning goes out once with no record of having sent it.
async function warnIfPoolFilling(context, pool, count) {
  const alertTo = context.env.ALERT_EMAIL;
  if (count !== alertThreshold(pool) || !alertTo) return;
  const message = quotaWarningMessage(context.env, pool, count);
  const { ok } = await sendEmail(context.env, { to: alertTo, ...message });
  await logEmailEvent(context, ok ? 'email_quota_warning' : 'email_failed');
}

// Applies the limits, builds and sends. Returns a promise that never rejects;
// callers hand it to waitUntil so the response neither waits for the provider
// nor reveals how long it took. A skipped or failed send is logged, so a quota
// or DNS problem shows up.
async function deliverEmail(context, pool, to, build) {
  try {
    const { count, skipped } = await claimEmailSlot(context.env, pool, to);
    if (skipped) {
      await logEmailEvent(context, emailSkippedEvent(skipped, pool));
      return;
    }
    const message = build(context.env);
    const { ok } = await sendEmail(context.env, { to, ...message });
    if (!ok) await logEmailEvent(context, 'email_failed');
    await warnIfPoolFilling(context, pool, count);
  } catch (err) {
    console.error('email error', err);
    await logEmailEvent(context, 'email_failed');
  }
}

// Checked before a request is accepted, so a person is told the mail cannot
// go out instead of waiting for it. The pool is shared by everyone, so the
// answer says nothing about any one address. Returns a Response, or null
// when the pool has room.
export async function gateEmailPool(env, pool) {
  const { allowed, retryAfterSeconds } = await peekRateLimit(
    env, `email:pool:${pool}`, POOL_DAILY_LIMIT[pool], DAY_MS);
  if (allowed) return null;
  return jsonError(HTTP_SERVICE_UNAVAILABLE, 'email_unavailable', POOL_FULL_MESSAGE[pool],
    { 'Retry-After': String(retryAfterSeconds) });
}

// ── Feedback ──

const FEEDBACK_SUBJECT_MAX = 60;
const VISITOR_SIGNATURE = 'From a visitor who was not signed in.';

// Plain text: it is a note to the owner, not mail a person receives.
function feedbackMessage(message, senderEmail) {
  return {
    subject: `Feedback: ${oneLine(message, FEEDBACK_SUBJECT_MAX)}`,
    text: [message, '', senderEmail ? `From ${senderEmail}.` : VISITOR_SIGNATURE].join('\n'),
  };
}

// Every message goes to the one FEEDBACK_EMAIL inbox, so only the pool is
// counted: the per-address limit would stop it after a handful. A signed-in
// sender is the Reply-To, so answering is one click. Returns { sent } and,
// when today's pool is used up, { isPoolFull }.
export async function sendFeedbackEmail(context, { message, senderEmail }) {
  const { env } = context;
  if (!env.FEEDBACK_EMAIL) return { sent: false };
  const pool = EMAIL_POOL.FEEDBACK;
  const { count } = await hitRateLimit(env, `email:pool:${pool}`, DAY_MS);
  if (count > POOL_DAILY_LIMIT[pool]) {
    await logEmailEvent(context, emailSkippedEvent('pool', pool));
    return { sent: false, isPoolFull: true };
  }
  const { ok } = await sendEmail(env, {
    to: env.FEEDBACK_EMAIL, ...feedbackMessage(message, senderEmail), replyTo: senderEmail,
  });
  await logEmailEvent(context, ok ? 'feedback_sent' : 'email_failed');
  await warnIfPoolFilling(context, pool, count);
  return { sent: ok };
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

export function sendSetPasswordEmail(context, { to, token }) {
  return deliverEmail(context, EMAIL_POOL.ACCOUNT, to, env => setPasswordMessage(env, token));
}

export function sendPasswordChangedEmail(context, { to }) {
  return deliverEmail(context, EMAIL_POOL.ACCOUNT, to, env => passwordChangedMessage(env));
}

export function sendGoogleAddedEmail(context, { to, token }) {
  return deliverEmail(context, EMAIL_POOL.ACCOUNT, to, env => googleAddedMessage(env, token));
}
