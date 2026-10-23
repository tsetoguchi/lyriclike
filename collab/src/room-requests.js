// What the site asks of a room over its binding, read from the request, and
// how the room answers.

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const ERROR_STATUS = { not_found: HTTP_NOT_FOUND, busy: HTTP_CONFLICT };

// The address rides in the body, so it stays out of request logs. A site
// deployed before this room change still sends it in the query.
export async function readEvictEmail(request) {
  const url = new URL(request.url);
  try {
    const body = await request.json();
    if (body && typeof body.email === 'string') return body.email;
  } catch {
    // No body, or not JSON: the older query form below.
  }
  return url.searchParams.get('email');
}

// The words that go over the whole page: both strings, or null.
export async function readReplaceRequest(request) {
  try {
    const body = await request.json();
    if (body && typeof body.title === 'string' && typeof body.body === 'string') {
      return { title: body.title, body: body.body };
    }
  } catch {
    // Not JSON: refused below.
  }
  return null;
}

// RoomCore#replace's result as the site reads it.
export function replaceAnswer(result) {
  if (result.error) return Response.json({ error: result.error }, { status: ERROR_STATUS[result.error] });
  return Response.json({ revision: result.revision, updated_at: result.updatedAt });
}
