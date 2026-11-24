// POST /api/collect { client_id, platform, signed_in, events: [{ name, params }] }
//
// Hands the app's analytics to Google. Google's tag sends nothing from inside
// the iPhone app, so analytics-relay.js posts the app's events here, and this
// sends them on through Google's Measurement Protocol. The person's country
// comes from Cloudflare, since Google would otherwise place every app visitor
// where this server runs. Only names, short values and numbers pass: never
// lyric text, same as on the website.
//
// It needs GA_MEASUREMENT_ID and GA_API_SECRET. Without them it answers 204
// and sends nothing, so a copy of the site never reports to anyone.

import { HOUR_MS, checkRateLimit, clientIpKey, rateLimitedResponse } from '../_ratelimit.js';
import { readJsonBody } from '../_request.js';
import { jsonError } from '../_shared.js';

const GA_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';
// The app sends at most one batch every 10 seconds.
const SENDS_PER_IP_HOUR = 400;
// Google's own limits for one request.
export const MAX_EVENTS = 25;
export const MAX_PARAMS = 25;
const MAX_VALUE_CHARS = 100;
const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const CLIENT_ID_PATTERN = /^\d{1,10}\.\d{1,10}$/;
const SIGNED_IN_VALUES = Object.freeze(['yes', 'no']);
const OPERATING_SYSTEMS = Object.freeze({ ios: 'iOS', android: 'Android' });
const MOBILE_CATEGORY = 'mobile';
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;

function isConfigured(env) {
  return Boolean(env.GA_MEASUREMENT_ID && env.GA_API_SECRET);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// A value Google can store, or undefined for anything else.
function cleanValue(value) {
  if (typeof value === 'string') return value.slice(0, MAX_VALUE_CHARS);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

// A param Google can't store (an empty value, a list, a bad name) is left
// out on its own, so one odd value never costs the whole batch.
function cleanParams(params) {
  if (params === undefined) return {};
  if (!isPlainObject(params) || Object.keys(params).length > MAX_PARAMS) return null;
  const cleaned = {};
  for (const [key, value] of Object.entries(params)) {
    const kept = cleanValue(value);
    if (NAME_PATTERN.test(key) && kept !== undefined) cleaned[key] = kept;
  }
  return cleaned;
}

function cleanEvent(event) {
  if (!isPlainObject(event) || !NAME_PATTERN.test(event.name || '')) return null;
  const params = cleanParams(event.params);
  return params ? { name: event.name, params } : null;
}

// The batch as Google should get it, or null when any part is malformed.
export function readBatch(body) {
  if (!isPlainObject(body) || !CLIENT_ID_PATTERN.test(body.client_id || '')) return null;
  const { events } = body;
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) return null;
  const cleaned = events.map(cleanEvent);
  if (cleaned.includes(null)) return null;
  const platform = Object.hasOwn(OPERATING_SYSTEMS, body.platform) ? body.platform : null;
  const signedIn = SIGNED_IN_VALUES.includes(body.signed_in) ? body.signed_in : null;
  return { clientId: body.client_id, platform, signedIn, events: cleaned };
}

function buildUserProperties(batch) {
  const properties = {};
  if (batch.platform) properties.app_platform = { value: batch.platform };
  if (batch.signedIn) properties.signed_in = { value: batch.signedIn };
  return properties;
}

export function buildPayload(batch, country) {
  const payload = {
    client_id: batch.clientId,
    user_properties: buildUserProperties(batch),
    events: batch.events,
  };
  if (country) payload.user_location = { country_id: country };
  if (batch.platform) {
    payload.device = { category: MOBILE_CATEGORY, operating_system: OPERATING_SYSTEMS[batch.platform] };
  }
  return payload;
}

async function sendToGoogle(env, payload) {
  const url = new URL(GA_COLLECT_URL);
  url.searchParams.set('measurement_id', env.GA_MEASUREMENT_ID);
  url.searchParams.set('api_secret', env.GA_API_SECRET);
  try {
    const response = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
    if (!response.ok) console.error('analytics relay: Google answered', response.status);
  } catch (error) {
    console.error('analytics relay: Google could not be reached', error);
  }
}

function countryOf(request) {
  const country = request.cf && request.cf.country;
  return typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const batch = readBatch(await readJsonBody(request));
  if (!batch) return jsonError(HTTP_BAD_REQUEST, 'invalid_events', 'Those events could not be read.');
  if (!isConfigured(env)) return new Response(null, { status: HTTP_NO_CONTENT });

  const limit = await checkRateLimit(
    env, `collect:ip:${clientIpKey(request)}`, SENDS_PER_IP_HOUR, HOUR_MS);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  context.waitUntil(sendToGoogle(env, buildPayload(batch, countryOf(request))));
  return new Response(null, { status: HTTP_NO_CONTENT });
}
