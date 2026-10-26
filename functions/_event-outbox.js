// The event hook's outbox: a message that failed both tries is parked here
// and sent again on later page loads. It imports nothing, so the collab room
// can park its messages the same way.

export const RETRY_BASE_MS = 60 * 1000;
export const RETRY_CAP_MS = 6 * 60 * 60 * 1000;

const PAGE_SAVED = 'page.saved';
const FIRST_ATTEMPTS = 1;

// Doubles with each try up to the cap, then picks a point in its upper half,
// so many messages that failed together don't all come back together.
export function retryDelay(attempts, random = Math.random) {
  const ceiling = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_CAP_MS);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

// A save is parked only while its page exists, so a resend can never bring
// back the words of a page deleted in the meantime. Returns whether it went in.
export async function parkEvent(db, message, now) {
  const pageId = (message.data && message.data.page_id) || null;
  const isSave = message.type === PAGE_SAVED;
  const guard = isSave ? 'WHERE EXISTS (SELECT 1 FROM lyrics WHERE id = ?)' : '';
  const parked = await db.prepare(`
    INSERT INTO event_outbox (id, page_id, body, attempts, next_attempt_at, created_at)
    SELECT ?, ?, ?, ?, ?, ? ${guard}
  `).bind(message.id, pageId, JSON.stringify(message), FIRST_ATTEMPTS,
    now + retryDelay(FIRST_ATTEMPTS), now, ...(isSave ? [pageId] : [])).run();
  return parked.meta.changes > 0;
}
