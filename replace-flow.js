// The order of a whole-page replace, kept apart from the editor so Node can
// test it. Words typed in the last second must not be lost: the editor is
// locked before the last save, so nothing typed can slip past it, and stays
// locked until the answer is in; an answer for a page no longer open is
// dropped, and one replace runs at a time. The browser loads this as a plain
// script and reads window.ReplaceFlow; Node loads it with require.
(function exposeReplaceFlow(root) {
  'use strict';

  const STATUS_OK = 200;
  const BUSY_STATUSES = [409, 503];
  const REASON_BUSY = 'busy';
  const REASON_NOT_READY = 'not-ready';
  const REASON_OFFLINE = 'offline';
  const REASON_PAGE_CHANGED = 'page-changed';

  // A second replace would lock over the first's lock, and the first one's
  // unlock would then free the editor while the second is still out.
  let isReplacing = false;

  function refuse(reason) {
    return { ok: false, reason };
  }

  function reasonFor(status) {
    return BUSY_STATUSES.includes(status) ? REASON_BUSY : String(status);
  }

  // A save in the flush can open the conflict bar, or fail and leave words
  // the server does not have; the replace must go over neither.
  function checkAfterFlush(steps) {
    const notReady = steps.readiness();
    if (notReady) return notReady;
    return steps.hasUnsaved() ? REASON_NOT_READY : null;
  }

  // Answers the reply, or why nothing was sent. Locked before the
  // flush, so nothing typed can land after the last save, and unlocked
  // whatever happens. The page is noted before the flush: one opened during
  // it must not get the words meant for this one.
  async function sendLocked(steps, words) {
    const wasEditable = steps.lock();
    try {
      const id = steps.pageId();
      await steps.flush();
      if (steps.pageId() !== id) return { refused: REASON_PAGE_CHANGED };
      const notReady = checkAfterFlush(steps);
      if (notReady) return { refused: notReady };
      return { id, reply: await steps.send(id, words) };
    } finally {
      steps.unlock(wasEditable);
    }
  }

  async function replaceOnce(steps, words) {
    const notReady = steps.readiness();
    if (notReady) return refuse(notReady);
    let sent;
    try {
      sent = await sendLocked(steps, words);
    } catch (error) {
      return refuse(REASON_OFFLINE);
    }
    if (sent.refused) return refuse(sent.refused);
    if (steps.pageId() !== sent.id) return refuse(REASON_PAGE_CHANGED);
    if (sent.reply.status !== STATUS_OK) return refuse(reasonFor(sent.reply.status));
    steps.apply(sent.reply.answer, words);
    return { ok: true };
  }

  async function runReplace(steps, words) {
    if (isReplacing) return refuse(REASON_BUSY);
    isReplacing = true;
    try {
      return await replaceOnce(steps, words);
    } finally {
      isReplacing = false;
    }
  }

  const ReplaceFlow = { runReplace };

  if (typeof module === 'object' && module.exports) {
    module.exports = ReplaceFlow;
  } else {
    root.ReplaceFlow = ReplaceFlow;
  }
})(this);
