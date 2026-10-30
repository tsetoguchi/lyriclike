// GET  /api/me/invite  this account's invite link and how many friends joined
// POST /api/me/invite  a new account says which invite link brought it here
//
// A friend counts once they save a page; then both sides get extra pages, and
// the event hook hears invite.rewarded.

import {
  MAX_REWARDED_FRIENDS, bonusPagesPerFriend, claimInvite, countRewardedFriends,
  findOrCreateInviteCode, isCodeShaped,
} from '../../_friend-invites.js';
import { queueInviteRewarded } from '../../_page-events.js';
import { readJsonObject } from '../../_pages.js';
import { jsonError, requireUser, writeLog } from '../../_shared.js';

const INVITE_PARAM = 'invite';
const HTTP_BAD_REQUEST = 400;

export async function onRequestGet({ request, env }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const code = await findOrCreateInviteCode(env, user.id);
  const link = new URL('/', request.url);
  link.searchParams.set(INVITE_PARAM, code);
  return Response.json({
    url: link.href,
    friends_joined: await countRewardedFriends(env, user.id),
    pages_per_friend: bonusPagesPerFriend(env),
    max_friends: MAX_REWARDED_FRIENDS,
  });
}

// An unknown code, the account's own, or an account too old to be new all
// answer claimed: false. The browser forgets the code either way. rewarded
// says the friend had already saved a page, so the pages are theirs now.
export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const body = await readJsonObject(request);
  if (!body || !isCodeShaped(body.code)) {
    return jsonError(HTTP_BAD_REQUEST, 'bad_code', 'That invite link is not valid.');
  }
  const { isClaimed, isRewarded, inviterId } = await claimInvite(
    env, user.id, body.code, Date.now());
  if (isClaimed) await writeLog(env, request, { userId: user.id, event: 'friend_invite_claimed' });
  if (isRewarded) queueInviteRewarded(context, inviterId, user.id);
  return Response.json({
    claimed: isClaimed, rewarded: isRewarded, pages_per_friend: bonusPagesPerFriend(env),
  });
}
