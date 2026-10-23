// The room's side of the event hook: the same signed messages the site
// sends, through the same sender. Unset, sending is a function that does
// nothing, so the room does no extra work.
import { isEventHookSet, sendEvent } from '../../functions/_event-hook.js';
import { writeEvent } from './d1-page.js';

const HOOK_FAILED_EVENT = 'event_hook_failed';

export function createEventSender({ env, waitUntil, now }) {
  if (!isEventHookSet(env)) return () => {};
  const onFailed = () => writeEvent(env.lyricalmiracle_db, null, HOOK_FAILED_EVENT, now());
  return event => waitUntil(sendEvent(env, event, { onFailed }));
}
