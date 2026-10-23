// The event hook: a signed message to EVENT_HOOK_URL when something happens
// to a page. Off unless both values are set. It imports nothing, so the
// collab room can send the same messages.

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

// One try. Returns the status, or 'network' when there was no answer.
async function postOnce(env, rawBody) {
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

function isDelivered(status) {
  return typeof status === 'number' && status >= 200 && status < 300;
}

// Never throws: a message that can't be sent must not touch what caused it.
// The log line holds no body and no address, since both may be private.
export async function sendEvent(env, event, { onFailed, wait = sleep } = {}) {
  const rawBody = JSON.stringify(event);
  let status;
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(RETRY_DELAY_MS);
    status = await postOnce(env, rawBody);
    if (isDelivered(status)) return;
  }
  console.error('event hook failed', event.type, status);
  try {
    if (onFailed) await onFailed();
  } catch (err) {
    console.error('event hook failure not logged', err);
  }
}
