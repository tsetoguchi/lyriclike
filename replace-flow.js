// The order of a whole-page replace, kept apart from the editor so Node can
// test it. Words typed in the last second must not be lost: saves still out
// land first, the editor is locked from the moment the page is noted until
// the answer is in, and an answer for a page no longer open is dropped. The
// browser loads this as a plain script and reads window.ReplaceFlow; Node
// loads it with require.
(function exposeReplaceFlow(root) {
  'use strict';

  const STATUS_OK = 200;
  const BUSY_STATUSES = [409, 503];
  const REASON_BUSY = 'busy';
  const REASON_OFFLINE = 'offline';
  const REASON_PAGE_CHANGED = 'page-changed';

  function refuse(reason) {
    return { ok: false, reason };
  }

  function reasonFor(status) {
    return BUSY_STATUSES.includes(status) ? REASON_BUSY : String(status);
  }

  // Locked before the request so nothing typed while it is out can be
  // overwritten by the answer; unlocked whatever the request does.
  async function sendLocked(steps, id, words) {
    const wasEditable = steps.lock();
    try {
      return await steps.send(id, words);
    } finally {
      steps.unlock(wasEditable);
    }
  }

  // A save that ran in the flush can open the conflict bar, so readiness is
  // asked again before anything is sent.
  async function flushThenCheck(steps) {
    try {
      await steps.flush();
    } catch (error) {
      return REASON_OFFLINE;
    }
    return steps.readiness();
  }

  async function runReplace(steps, words) {
    const notReady = steps.readiness() || await flushThenCheck(steps);
    if (notReady) return refuse(notReady);
    const id = steps.pageId();
    let reply;
    try {
      reply = await sendLocked(steps, id, words);
    } catch (error) {
      return refuse(REASON_OFFLINE);
    }
    if (steps.pageId() !== id) return refuse(REASON_PAGE_CHANGED);
    if (reply.status !== STATUS_OK) return refuse(reasonFor(reply.status));
    steps.apply(reply.answer, words);
    return { ok: true };
  }

  const ReplaceFlow = { runReplace };

  if (typeof module === 'object' && module.exports) {
    module.exports = ReplaceFlow;
  } else {
    root.ReplaceFlow = ReplaceFlow;
  }
})(this);
