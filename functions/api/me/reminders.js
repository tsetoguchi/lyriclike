// PUT /api/me/reminders { on }
//
// The account menu's "Song reminders" switch: whether this account gets the
// "your song is waiting" email. On unless turned off.

import { describeAccount } from '../../_accounts.js';
import { setRemindersOn } from '../../_reminders.js';
import { readJsonBody } from '../../_request.js';
import { jsonError, requireUser } from '../../_shared.js';

const HTTP_BAD_REQUEST = 400;

export async function onRequestPut({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;
  const body = await readJsonBody(request);
  if (!body || typeof body.on !== 'boolean') {
    return jsonError(HTTP_BAD_REQUEST, 'bad_request', 'Send { "on": true } or { "on": false }.');
  }
  await setRemindersOn(env, user.id, body.on);
  return Response.json({ user: await describeAccount(env, user.id) });
}
