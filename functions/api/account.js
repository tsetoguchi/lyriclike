// Reading the account and deleting it live apart, so the read every page
// load makes (GET /api/me) stays simple.

import { checkCurrentPassword } from '../_accounts.js';
import { isEventHookSet } from '../_event-hook.js';
import { closeRoom, evictFromRoom } from '../_live.js';
import { queueAccountDeleted } from '../_page-events.js';
import { readJsonBody } from '../_request.js';
import { clearedSessionCookie, requireUser, writeLog } from '../_shared.js';

// An account with a password has to give it again: a session left open on a
// shared computer must not be enough to wipe everything. An account with only
// Google has no password to ask for; the client makes the person type the
// address instead. This check runs even with the password flag off, since the
// password it checks already exists.
async function refuseWithoutPassword(request, env, userId) {
  const row = await env.lyricalmiracle_db.prepare(
    'SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!row || !row.has_password) return null;

  const body = await readJsonBody(request);
  const { response } = await checkCurrentPassword(env, userId, body && body.password);
  return response || null;
}

// The rooms an account's deletion must close (its shared pages) and leave
// (pages shared with it). Read before the delete batch removes the rows.
async function roomsToLeave(env, user) {
  const db = env.lyricalmiracle_db;
  const [owned, joined] = await Promise.all([
    db.prepare('SELECT id FROM lyrics WHERE user_id = ? AND EXISTS ' +
      '(SELECT 1 FROM lyric_shares WHERE lyric_shares.lyric_id = lyrics.id)').bind(user.id).all(),
    db.prepare('SELECT lyric_id AS id FROM lyric_shares WHERE email_normalized = ?')
      .bind(user.email_normalized).all(),
  ]);
  return { owned: owned.results.map(row => row.id), joined: joined.results.map(row => row.id) };
}

// Every page the account owns, for the event hook. Read only when it's set.
async function ownedPageIds(env, user) {
  if (!isEventHookSet(env)) return [];
  const owned = await env.lyricalmiracle_db.prepare('SELECT id FROM lyrics WHERE user_id = ?')
    .bind(user.id).all();
  return owned.results.map(row => row.id);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const refused = await refuseWithoutPassword(request, env, user.id);
  if (refused) return refused;

  await writeLog(env, request, { userId: user.id, event: 'delete_account' });

  const rooms = await roomsToLeave(env, user);
  const pageIds = await ownedPageIds(env, user);
  await env.lyricalmiracle_db.batch([
    env.lyricalmiracle_db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    // Shares on this user's pages, then this user's access to other pages.
    // Both hold foreign keys, so they go before the lyrics and the user.
    env.lyricalmiracle_db.prepare(
      'DELETE FROM lyric_shares WHERE lyric_id IN (SELECT id FROM lyrics WHERE user_id = ?)'
    ).bind(user.id),
    env.lyricalmiracle_db.prepare(
      'DELETE FROM lyric_shares WHERE user_id = ? OR email_normalized = ' +
      '(SELECT email_normalized FROM users WHERE id = ?)'
    ).bind(user.id, user.id),
    // Parked event hook saves hold the pages' words, so they go too.
    env.lyricalmiracle_db.prepare(
      'DELETE FROM event_outbox WHERE page_id IN (SELECT id FROM lyrics WHERE user_id = ?)'
    ).bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM lyrics WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM logs WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM identities WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare(
      'DELETE FROM pending_signups WHERE email_normalized = ' +
      '(SELECT email_normalized FROM users WHERE id = ?)'
    ).bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM user_limits WHERE user_id = ?').bind(user.id),
    // A friend who leaves takes the inviter's bonus for them with it, so an
    // account made and deleted again can't farm pages.
    env.lyricalmiracle_db.prepare(
      'DELETE FROM friend_invites WHERE friend_id = ? OR inviter_id = ?'
    ).bind(user.id, user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM invite_codes WHERE user_id = ?').bind(user.id),
    env.lyricalmiracle_db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  for (const id of rooms.owned) closeRoom(context, id);
  for (const id of rooms.joined) evictFromRoom(context, id, user.email_normalized);
  queueAccountDeleted(context, user.id, pageIds);

  const headers = new Headers();
  headers.append('Set-Cookie', clearedSessionCookie(new URL(request.url)));
  return new Response(null, { status: 200, headers });
}
