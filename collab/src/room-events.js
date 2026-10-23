// The messages the room sends through the event hook, in the same shape the
// site's page routes send (functions/_page-events.js).

const PAGE_SAVED = 'page.saved';
const ROOM_EMPTIED = 'page.room_emptied';

// The room's `written` state as a message carries a page.
export function writtenSnapshot({ title, text, revision, updatedAt }) {
  return { title, body: text, revision, updated_at: updatedAt };
}

export function pageSavedEvent({ pageId, ownerId, writerIds, reason, tag = null, before, after }) {
  return {
    type: PAGE_SAVED,
    data: { page_id: pageId, owner_id: ownerId, writer_ids: writerIds, reason, tag, before, after },
  };
}

export function roomEmptiedEvent(pageId) {
  return { type: ROOM_EMPTIED, data: { page_id: pageId } };
}
