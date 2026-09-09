// Every answer under /api depends on who is asking: the session cookie decides
// whether it is a lyric or a 401. Cloudflare's default of "public, max-age=0"
// with no Vary lets a signed-out 401 be held and handed back after signing in,
// which reads as the sign-in having failed.
export async function onRequest(context) {
  const response = await context.next();

  // A route that has already said how it may be cached knows its own business:
  // the definition proxy caches at the edge on purpose, and asks nobody.
  if (response.headers.has('Cache-Control')) return response;

  const answer = new Response(response.body, response);
  answer.headers.set('Cache-Control', 'private, no-store');
  answer.headers.set('Vary', 'Cookie');
  return answer;
}
