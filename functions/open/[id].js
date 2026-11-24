// GET /open/<page>: a page link for emails. In the iOS app, Apple sends it
// straight to the app (.well-known/apple-app-site-association), and
// native-shell.js opens the page there. Anywhere else it lands here and goes
// on to the link the website already understands, /#shared=<page>, which also
// asks a signed-out person to log in first.

const PAGE_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const FROM_PATTERN = /^[a-z]{1,20}$/;
const HTTP_FOUND = 302;

export function onRequestGet({ request, params }) {
  const url = new URL(request.url);
  const id = String(params.id || '');
  if (!PAGE_ID_PATTERN.test(id)) return Response.redirect(`${url.origin}/`, HTTP_FOUND);
  const from = url.searchParams.get('from');
  const fromPart = from && FROM_PATTERN.test(from) ? `&from=${from}` : '';
  return Response.redirect(`${url.origin}/#shared=${id}${fromPart}`, HTTP_FOUND);
}
