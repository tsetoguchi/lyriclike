// What every password route does with a request before its own work starts.

const MAX_BODY_CHARS = 16 * 1024;
const HTTP_NOT_FOUND = 404;

export function passwordAuthEnabled(env) {
  return env.PASSWORD_AUTH_ENABLED === 'true';
}

// The kill switch. With the flag off the password routes answer as if they did
// not exist. Returns a Response to send back, or null when the route may run.
export function gatePasswordAuth(env) {
  return passwordAuthEnabled(env) ? null : new Response(null, { status: HTTP_NOT_FOUND });
}

// Returns the parsed JSON object, or null for a missing, oversized, malformed
// or non-object body.
export async function readJsonBody(request) {
  const text = await request.text();
  if (!text || text.length > MAX_BODY_CHARS) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// Work that should not delay the response, or show in how long it took. A
// failure is logged; the response has already gone.
export function runInBackground(context, label, work) {
  context.waitUntil(work().catch(err => console.error(label, err)));
}
