// The event hook: a signed message to EVENT_HOOK_URL when something happens
// to a page. Off unless both values are set. It imports only the outbox,
// which imports nothing, so the collab room can send the same messages.

import { parkEvent } from './_event-outbox.js';

export const SIGNATURE_HEADER = 'X-Event-Signature';
const RETRY_DELAY_MS = 1000;
const SEND_TIMEOUT_MS = 5000;
const SEND_ATTEMPTS = 2;
const MS_PER_SECOND = 1000;

export function isEventHookSet(env) {
  return Boolean(env.EVENT_HOOK_URL) && Boolean(env.EVENT_HOOK_SECRET);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

// "t=<seconds>,v1=<hex HMAC-SHA256 of t.body>": the time is signed with the
// body, so the receiver can refuse an old message sent again.
export async function signatureHeader(secret, rawBody, unixSeconds) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${unixSeconds}.${rawBody}`));
  return `t=${unixSeconds},v1=${toHex(mac)}`;
}

// One try. Returns the status, or 'network' when there was no answer. Signed
// at send time, so a parked message resent hours later is still fresh.
export async function postEvent(env, rawBody) {
  const unixSeconds = Math.floor(Date.now() / MS_PER_SECOND);
  try {
    const response = await fetch(env.EVENT_HOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SIGNATURE_HEADER]: await signatureHeader(env.EVENT_HOOK_SECRET, rawBody, unixSeconds),
      },
      body: rawBody,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return 'network';
  }
}

export function isDelivered(status) {
  return typeof status === 'number' && status >= 200 && status < 300;
}

async function reportFailed(onFailed) {
  try {
    if (onFailed) await onFailed();
  } catch (err) {
    console.error('event hook failure not logged', err);
  }
}

// Never throws: a message that can't be sent must not touch what caused it.
// The id stays the same on every try and resend, so the receiver can drop
// repeats. After two misses the message is parked for a later page load;
// onFailed runs only if even that fails. The log lines hold no body and no
// address, since both may be private.
export async function sendEvent(env, event, { onFailed, wait = sleep, now = Date.now } = {}) {
  const message = { id: crypto.randomUUID(), ...event };
  const rawBody = JSON.stringify(message);
  let status;
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(RETRY_DELAY_MS);
    status = await postEvent(env, rawBody);
    if (isDelivered(status)) return;
  }
  console.error('event hook failed', event.type, status);
  try {
    await parkEvent(env.lyricalmiracle_db, message, now());
  } catch {
    console.error('event hook message not parked', event.type);
    await reportFailed(onFailed);
  }
}
