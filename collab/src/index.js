// The live-editing Worker. Its only way in is the Pages site's PAGE_ROOM
// binding: its own URL answers 404, because the room trusts the X-Room-*
// headers that binding sends.
export { PageRoom } from './page-room.js';

const HTTP_NOT_FOUND = 404;

export default {
  fetch() {
    return new Response(null, { status: HTTP_NOT_FOUND });
  },
};
