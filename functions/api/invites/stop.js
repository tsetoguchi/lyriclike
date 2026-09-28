// "Stop emails like this." Puts an address on the list that invites are never
// sent to. Only a POST acts: mail scanners open every link in a mail, and a
// GET that opted people out would do it before they had read anything.
//
// Two callers. The app's button sends JSON { token }. A mail app's one-click
// unsubscribe sends ?token= in the URL with the form body
// "List-Unsubscribe=One-Click"; the API guard lets this one path through.
// Both get 200 whatever the token, so the route can't be probed.

import { verifyStopToken } from '../../_email.js';
import { readJsonBody } from '../../_request.js';
import { writeLog } from '../../_shared.js';

async function readToken(request) {
  const fromUrl = new URL(request.url).searchParams.get('token');
  if (fromUrl) return fromUrl;
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json')) return null;
  const body = await readJsonBody(request);
  return body && body.token;
}

export async function onRequestPost({ request, env }) {
  const addressHash = await verifyStopToken(env, await readToken(request));
  if (addressHash) {
    const added = await env.lyricalmiracle_db.prepare(
      'INSERT INTO email_suppressions (address_hash, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING'
    ).bind(addressHash, Date.now()).run();
    if (added.meta.changes > 0) await writeLog(env, request, { event: 'invite_stopped' });
  }
  return Response.json({ ok: true });
}
