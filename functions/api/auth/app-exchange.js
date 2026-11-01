// POST /api/auth/app-exchange — the last step of Google sign-in in the app.
// The system browser finished the sign-in and handed the app a one-time code
// through lyriclike://auth. The app proves it is the one that started the
// sign-in by sending the secret whose hash it gave at the start, and gets a
// session token back. Another app that grabbed the code from the URL does not
// have that secret.
import { SIGNIN_TICKET, redeemAppTicket } from '../../_app-tickets.js';
import { describeAccount } from '../../_accounts.js';
import { createSession, jsonError, sha256Hex } from '../../_shared.js';
import { readJsonBody } from '../../_request.js';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;

function rejectExchange() {
  return jsonError(HTTP_UNAUTHORIZED, 'invalid_code', 'That sign-in has expired. Try again.');
}

export async function onRequestPost({ request, env }) {
  const body = await readJsonBody(request);
  if (!body || typeof body.code !== 'string' || typeof body.verifier !== 'string') {
    return jsonError(HTTP_BAD_REQUEST, 'bad_request', 'Missing code.');
  }

  const row = await redeemAppTicket(env, body.code, SIGNIN_TICKET);
  if (!row || row.challenge !== await sha256Hex(body.verifier)) return rejectExchange();

  const token = await createSession(env, row.user_id);
  return Response.json({ user: await describeAccount(env, row.user_id), token });
}
