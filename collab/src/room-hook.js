// The room's side of the event hook: the same signed messages the site
// sends, through the same sender. Unset, sending is a function that does
// nothing, so the room does no extra work.
import { isEventHookSet, sendEvent } from '../../functions/_event-hook.js';
import { writeEvent } from './d1-page.js';

const HOOK_FAILED_EVENT = 'event_hook_failed';

export function createEventSender({ env, waitUntil, now }) {
  if (!isEventHookSet(env)) return () => {};
  const onFailed = () => writeEvent(env.lyricalmiracle_db, null, HOOK_FAILED_EVENT, now());
  // One message at a time, in order: a replace's flush must not arrive
  // after the replace when its first try fails. sendEvent never throws.
  let tail = Promise.resolve();
  return event => {
    tail = tail.then(() => sendEvent(env, event, { onFailed, now }));
    waitUntil(tail);
  };
}
