// Single-use tickets for the mobile apps (see migrations/0011_app_tickets.sql).

import { randomHex, sha256Hex } from './_shared.js';

export const SOCKET_TICKET = 'socket';
export const SIGNIN_TICKET = 'signin';

const TICKET_BYTES = 32;
const TICKET_LIFETIME_MS = 60 * 1000;

// Returns the raw ticket. The database keeps only its hash, like a session.
export async function issueAppTicket(env, { kind, userId, sessionId = null, challenge = null }) {
  const ticket = randomHex(TICKET_BYTES);
  await env.lyricalmiracle_db.prepare(
    'INSERT INTO app_tickets (id, kind, user_id, session_id, challenge, expires_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(await sha256Hex(ticket), kind, userId, sessionId, challenge, Date.now() + TICKET_LIFETIME_MS).run();
  return ticket;
}

// Deleting and reading in one statement is what makes a ticket single-use: two
// requests racing with the same ticket cannot both get a row back.
export async function redeemAppTicket(env, ticket, kind) {
  if (typeof ticket !== 'string' || !ticket) return null;
  return env.lyricalmiracle_db.prepare(`
    DELETE FROM app_tickets WHERE id = ? AND kind = ? AND expires_at > ?
    RETURNING user_id, session_id, challenge
  `).bind(await sha256Hex(ticket), kind, Date.now()).first();
}
