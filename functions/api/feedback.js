// POST /api/feedback { message }
//
// The sidebar's feedback box. The message is emailed to FEEDBACK_EMAIL, with
// a signed-in sender's address as the Reply-To. Anyone may send, so each IP
// gets a few an hour, and the feedback pool caps the day.

import { HOUR_MS, checkRateLimit, clientIpKey, rateLimitedResponse } from '../_ratelimit.js';
import { readJsonBody } from '../_request.js';
import { sendFeedbackEmail } from '../_email.js';
import { getUser, jsonError } from '../_shared.js';

export const MESSAGE_MAX_CHARS = 2000;
const SENDS_PER_IP_HOUR = 5;
const HTTP_BAD_REQUEST = 400;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

// The trimmed message, or null when there is none or it is too long.
function readMessage(body) {
  const message = body && typeof body.message === 'string' ? body.message.trim() : '';
  return message && message.length <= MESSAGE_MAX_CHARS ? message : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const message = readMessage(await readJsonBody(request));
  if (!message) {
    return jsonError(HTTP_BAD_REQUEST, 'invalid_message',
      `Write a message of up to ${MESSAGE_MAX_CHARS} characters.`);
  }

  const limit = await checkRateLimit(
    env, `feedback:ip:${clientIpKey(request)}`, SENDS_PER_IP_HOUR, HOUR_MS);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  const user = await getUser(request, env);
  const { sent, isPoolFull } = await sendFeedbackEmail(
    context, { message, senderEmail: user ? user.email : null });
  if (sent) return Response.json({ ok: true });
  if (isPoolFull) {
    return jsonError(HTTP_SERVICE_UNAVAILABLE, 'feedback_full',
      "I've had a lot of messages today. Try again tomorrow.");
  }
  return jsonError(HTTP_BAD_GATEWAY, 'feedback_failed', "Couldn't send it. Try again in a moment.");
}
