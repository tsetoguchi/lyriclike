// What the site asks of a room over its binding (collab/src/room-requests.js).
//
//   cd collab && npm install; cd .. && node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readEvictEmail, readReplaceRequest, replaceAnswer } from '../collab/src/room-requests.js';

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

describe('readReplaceRequest', () => {
  function post(body) {
    return new Request('https://room/replace', { method: 'POST', body });
  }

  it('reads the title and body', async () => {
    assert.deepEqual(await readReplaceRequest(post(JSON.stringify({ title: 'T', body: 'b' }))), { title: 'T', body: 'b' });
  });

  it('gives null for a body that is not a string, a missing title, or not JSON', async () => {
    assert.equal(await readReplaceRequest(post(JSON.stringify({ title: 'T', body: 4 }))), null);
    assert.equal(await readReplaceRequest(post(JSON.stringify({ body: 'b' }))), null);
    assert.equal(await readReplaceRequest(post('not json')), null);
  });
});

describe('replaceAnswer', () => {
  it('answers 200 with the revision and time', async () => {
    const response = replaceAnswer({ revision: 4, updatedAt: 9 });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { revision: 4, updated_at: 9 });
  });

  it('answers 404 for a page that is gone and 409 when busy', async () => {
    const gone = replaceAnswer({ error: 'not_found' });
    assert.equal(gone.status, 404);
    assert.deepEqual(await gone.json(), { error: 'not_found' });
    const busy = replaceAnswer({ error: 'busy' });
    assert.equal(busy.status, 409);
    assert.deepEqual(await busy.json(), { error: 'busy' });
  });
});
