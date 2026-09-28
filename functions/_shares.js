// Who can open a page: its owner, or anyone whose account email is on its
// share list. Both sign-in paths prove the address, so "signed in as that
// email" is the check. The link in an invite carries only the page id.

import { writeLog } from './_shared.js';

// Used as `... WHERE id = ? AND ${CAN_OPEN}`, bound with canOpenParams(user)
// after the page id.
export const CAN_OPEN =
  '(user_id = ? OR id IN (SELECT lyric_id FROM lyric_shares WHERE email_normalized = ?))';

export function canOpenParams(user) {
  return [user.id, user.email_normalized];
}

// A new account picks up the pages already shared with its address. Access
// matches on the email either way; the user_id is for speed and for the
// growth numbers (who signed up because of an invite).
export async function claimShares(env, request, userId, emailNormalized) {
  const claimed = await env.lyricalmiracle_db.prepare(
    'UPDATE lyric_shares SET user_id = ? WHERE email_normalized = ? AND user_id IS NULL'
  ).bind(userId, emailNormalized).run();
  if (claimed.meta.changes > 0) await writeLog(env, request, { userId, event: 'share_signup' });
}
