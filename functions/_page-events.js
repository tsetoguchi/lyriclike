// The messages the page and invite routes send through the event hook. Each is queued
// after the D1 write has landed, so it never slows or fails the request.
import { isEventHookSet, sendEvent } from './_event-hook.js';
import { writeLog } from './_shared.js';

// A page as the message carries it.
export function snapshot({ title, body, revision, updated_at: updatedAt }) {
  return { title, body, revision, updated_at: updatedAt };
}

// Runs a write that returns a row. With the hook set, the read that
// `readBefore()` makes runs in the same batch, which is one transaction, so
// nothing lands between the two and the read is exactly the page the write
// replaced. Unset, the write runs alone and nothing extra is read.
export async function writeWithBefore(env, readBefore, write) {
  if (!isEventHookSet(env)) return { row: await write.first(), before: null };
  const [read, written] = await env.lyricalmiracle_db.batch([readBefore(), write]);
  return { row: written.results[0] || null, before: read.results[0] || null };
}

function isSameWords(before, after) {
  return before !== null && before.title === after.title && before.body === after.body;
}

function queue(context, type, data) {
  const { env, request } = context;
  const onFailed = () => writeLog(env, request, { userId: null, event: 'event_hook_failed' });
  context.waitUntil(sendEvent(env, { type, data }, { onFailed }));
}

export function queuePageSaved(context, { pageId, ownerId, writerIds, reason, tag = null, before, after }) {
  if (!isEventHookSet(context.env) || isSameWords(before, after)) return;
  queue(context, 'page.saved', {
    page_id: pageId, owner_id: ownerId, writer_ids: writerIds, reason, tag, before, after,
  });
}

export function queuePageDeleted(context, pageId) {
  if (!isEventHookSet(context.env)) return;
  queue(context, 'page.deleted', { page_id: pageId });
}

export function queueAccountDeleted(context, userId, pageIds) {
  if (!isEventHookSet(context.env)) return;
  queue(context, 'account.deleted', { user_id: userId, page_ids: pageIds });
}

// A friend's first page has rewarded their invite. Sent once per friend.
export function queueInviteRewarded(context, inviterId, friendId) {
  if (!isEventHookSet(context.env)) return;
  queue(context, 'invite.rewarded', { inviter_id: inviterId, friend_id: friendId });
}
