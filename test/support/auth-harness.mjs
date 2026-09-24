// Shared setup for the password-account suites: an environment with every
// secret set, stand-ins for Resend, Have I Been Pwned and Turnstile, and a
// helper that calls a route handler the way Pages does.

import { hashPassword } from '../../functions/_password.js';
import { sha256Hex } from '../../functions/_shared.js';
import { createFakeD1 } from './fake-d1.mjs';

export const BASE_URL = 'https://lyriclike.com';
export const GOOD_PASSWORD = 'correct horse battery';
export const OTHER_PASSWORD = 'staple battery correct';
export const DEFAULT_IP = '203.0.113.7';

export function makeEnv(extra = {}) {
  return {
    lyricalmiracle_db: createFakeD1(),
    PASSWORD_AUTH_ENABLED: 'true',
    PASSWORD_PEPPER: 'test-pepper-not-a-secret',
    RESEND_API_KEY: 'resend-key',
    EMAIL_FROM: 'LyricLike <noreply@lyriclike.com>',
    APP_BASE_URL: BASE_URL,
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    ...extra,
  };
}

// The stand-in Turnstile accepts a token written "ok:<action>" and reports it
// as issued for that action on lyriclike.com.
export const turnstileToken = action => `ok:${action}`;

async function sha1Upper(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function rangeResponse(services, url) {
  if (services.hibpDown) return new Response('down', { status: 503 });
  const prefix = url.split('/range/')[1];
  services.hibpPrefixes.push(prefix);
  const lines = ['0000000000000000000000000000000000A:0'];
  for (const password of services.breached) {
    const digest = await sha1Upper(password.normalize('NFKC'));
    if (digest.startsWith(prefix)) lines.push(`${digest.slice(5)}:12`);
  }
  return new Response(lines.join('\r\n'));
}

function siteverifyResponse(services, form) {
  const token = form.get('response');
  services.turnstileCalls.push({ secret: form.get('secret'), token, remoteip: form.get('remoteip') });
  if (!token.startsWith('ok:')) return Response.json({ success: false });
  return Response.json({
    success: true,
    hostname: services.turnstileHostname,
    action: token.slice('ok:'.length),
  });
}

// Replaces global fetch. `mail` collects what Resend was asked to send.
export function stubServices({ breached = [] } = {}) {
  const original = globalThis.fetch;
  const services = {
    mail: [],
    mailRequests: [],
    turnstileCalls: [],
    hibpPrefixes: [],
    hibpHeaders: [],
    breached: new Set(breached),
    hibpDown: false,
    mailDown: false,
    turnstileHostname: 'lyriclike.com',
    restore() {
      globalThis.fetch = original;
    },
  };

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('api.resend.com')) {
      if (services.mailDown) return new Response('down', { status: 500 });
      services.mailRequests.push({ headers: init.headers, body: JSON.parse(init.body) });
      services.mail.push(JSON.parse(init.body));
      return Response.json({ id: 'email-id' });
    }
    if (target.includes('pwnedpasswords.com')) {
      services.hibpHeaders.push(init.headers);
      return rangeResponse(services, target);
    }
    if (target.includes('challenges.cloudflare.com')) {
      return siteverifyResponse(services, init.body);
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
  return services;
}

// Counts PBKDF2 derivations, the expensive step, so a test can say two paths
// cost the same.
export function countDerivations() {
  const subtle = crypto.subtle;
  const original = subtle.deriveBits;
  const counter = { count: 0, restore: () => { subtle.deriveBits = original; } };
  subtle.deriveBits = function deriveBits(...args) {
    counter.count += 1;
    return original.apply(this, args);
  };
  return counter;
}

export async function query(env, sql, ...params) {
  return (await env.lyricalmiracle_db.prepare(sql).bind(...params).all()).results;
}

export async function events(env) {
  return (await query(env, 'SELECT event FROM logs ORDER BY rowid')).map(row => row.event);
}

// Calls a route the way Pages does, then waits for whatever it queued with
// waitUntil. `body` may be an object or a raw string.
export async function post(handler, env, path, body, options = {}) {
  const { ip = DEFAULT_IP, cookie, method = 'POST' } = options;
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (cookie) headers.Cookie = cookie;

  const request = new Request(BASE_URL + path, {
    method,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const pending = [];
  const response = await handler.onRequestPost({
    request, env, waitUntil: promise => pending.push(promise),
  });
  await Promise.all(pending);
  return response;
}

// The raw token in the newest email that carries one for `key`.
export function latestToken(services, key) {
  const pattern = new RegExp(`#${key}=([0-9a-f]{64})`);
  for (let i = services.mail.length - 1; i >= 0; i--) {
    const found = pattern.exec(services.mail[i].text);
    if (found) return found[1];
  }
  return null;
}

export async function addPasswordUser(env, {
  id = 'user-1', email = 'ann@example.com', name = 'Ann', password = GOOD_PASSWORD,
} = {}) {
  await env.lyricalmiracle_db.prepare(`
    INSERT INTO users (id, email, email_normalized, name, password_hash, password_updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, email, email.trim().toLowerCase(), name, await hashPassword(password, env), 1, 1).run();
  return id;
}

export async function addGoogleUser(env, { id = 'google-1', email = 'ann@example.com' } = {}) {
  await env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare(
      'INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, email, email.trim().toLowerCase(), 'Ann', 1),
    env.lyricalmiracle_db.prepare(
      'INSERT INTO identities (id, user_id, provider, provider_subject, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(`identity-${id}`, id, 'google', `sub-${id}`, 1),
  ]);
  return id;
}

export async function addSession(env, userId, token) {
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(await sha256Hex(token), userId, Date.now() + 1e9, Date.now()).run();
}
