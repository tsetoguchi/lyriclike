// The app's analytics relay: what reaches Google, and what is turned away.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import * as collect from '../functions/api/collect.js';
import { makeEnv, post } from './support/auth-harness.mjs';

const COLLECT = '/api/collect';
const CLIENT_ID = '123456.1764000000';

let env;
let sent;
let originalFetch;

beforeEach(() => {
  env = makeEnv({ GA_MEASUREMENT_ID: 'G-TEST', GA_API_SECRET: 'secret-1' });
  sent = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: new URL(url), body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function batch(overrides = {}) {
  return {
    client_id: CLIENT_ID,
    platform: 'ios',
    signed_in: 'yes',
    events: [{ name: 'rhyme_lookup', params: { trigger: 'tap', session_id: 17, engagement_time_msec: 900 } }],
    ...overrides,
  };
}

describe('collect', () => {
  it('passes a batch to Google with the secret, the platform and the sign-in flag', async () => {
    const response = await post(collect, env, COLLECT, batch());
    assert.equal(response.status, 204);
    assert.equal(sent.length, 1);
    const [{ url, body }] = sent;
    assert.equal(url.origin + url.pathname, 'https://www.google-analytics.com/mp/collect');
    assert.equal(url.searchParams.get('measurement_id'), 'G-TEST');
    assert.equal(url.searchParams.get('api_secret'), 'secret-1');
    assert.equal(body.client_id, CLIENT_ID);
    assert.deepEqual(body.user_properties, {
      app_platform: { value: 'ios' }, signed_in: { value: 'yes' },
    });
    assert.deepEqual(body.device, { category: 'mobile', operating_system: 'iOS' });
    assert.deepEqual(body.events, batch().events);
  });

  it('places the visitor in their own country, not the server\'s', () => {
    const payload = collect.buildPayload(collect.readBatch(batch()), 'BR');
    assert.deepEqual(payload.user_location, { country_id: 'BR' });
    assert.equal(collect.buildPayload(collect.readBatch(batch()), null).user_location, undefined);
  });

  it('sends nothing when Google is not set up', async () => {
    env = makeEnv();
    const response = await post(collect, env, COLLECT, batch());
    assert.equal(response.status, 204);
    assert.equal(sent.length, 0);
  });

  it('turns away a malformed batch without sending', async () => {
    const tooMany = Array.from({ length: collect.MAX_EVENTS + 1 }, () => ({ name: 'x' }));
    const bad = [
      batch({ client_id: 'not-an-id' }),
      batch({ events: [] }),
      batch({ events: tooMany }),
      batch({ events: [{ name: 'has space' }] }),
      batch({ events: [{ name: 'ok', params: { nested: { a: 1 } } }] }),
      batch({ events: [{ name: 'ok', params: { 'bad-key': 1 } }] }),
    ];
    for (const body of bad) assert.equal((await post(collect, env, COLLECT, body)).status, 400);
    assert.equal(sent.length, 0);
  });

  it('cuts long values to Google\'s 100 characters', () => {
    const long = batch({ events: [{ name: 'exception', params: { description: 'x'.repeat(300) } }] });
    assert.equal(collect.readBatch(long).events[0].params.description.length, 100);
  });

  it('leaves out an unknown platform or sign-in value', () => {
    const payload = collect.buildPayload(collect.readBatch(batch({ platform: 'web', signed_in: 'maybe' })), null);
    assert.deepEqual(payload.user_properties, {});
    assert.equal(payload.device, undefined);
  });
});
