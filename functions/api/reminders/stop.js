// "Turn off these reminders." Only a POST acts: mail scanners open every link
// in a mail, and a GET that turned reminders off would do it before anyone
// had read anything.
//
// Two callers, as with /api/invites/stop. The app's button sends JSON
// { token }. A mail app's one-click unsubscribe sends ?token= in the URL with
// a form body; the API guard lets this path through. Both get 200 whatever
// the token, so the route can't be probed.

import { verifyReminderStopToken } from '../../_email.js';
import { setRemindersOn } from '../../_reminders.js';
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
  const userId = await verifyReminderStopToken(env, await readToken(request));
  if (userId) {
    const result = await setRemindersOn(env, userId, false);
    if (result.meta.changes > 0) await writeLog(env, request, { userId, event: 'reminders_stopped' });
  }
  return Response.json({ ok: true });
}
