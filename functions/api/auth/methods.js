import { passwordAuthEnabled } from '../../_request.js';

// Tells the sign-in modal what to offer. Always answers, even with the flag
// off: that is how the modal learns to show only Google.
export function onRequestGet({ env }) {
  return Response.json({ password: passwordAuthEnabled(env) });
}
