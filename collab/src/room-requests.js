// What the site asks of a room over its binding, read from the request.

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
