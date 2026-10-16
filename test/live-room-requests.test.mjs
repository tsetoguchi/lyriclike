// What the site asks of a room over its binding (collab/src/room-requests.js).
//
//   cd collab && npm install; cd .. && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readEvictEmail } from '../collab/src/room-requests.js';

const ROOM = 'https://room/evict';

describe('readEvictEmail', () => {
  it('reads the address from the body, where request logs do not show it', async () => {
    const request = new Request(ROOM, { method: 'POST', body: JSON.stringify({ email: 'bo@example.com' }) });
    assert.equal(await readEvictEmail(request), 'bo@example.com');
  });

  it('still reads it from the query, for a site deployed before the room', async () => {
    assert.equal(await readEvictEmail(new Request(`${ROOM}?email=bo%40example.com`, { method: 'POST' })), 'bo@example.com');
  });

  it('gives null when neither names anyone', async () => {
    assert.equal(await readEvictEmail(new Request(ROOM, { method: 'POST', body: 'not json' })), null);
  });
});
