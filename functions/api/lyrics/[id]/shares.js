// Who a page is shared with. The owner adds and removes people; anyone with
// the page can see the list (like Google Docs, editors see each other's
// emails). Adding someone emails them an invite, within tight limits: every
// invite goes out from our domain, and spam complaints would stop all mail,
// password resets included.

import {
  EMAIL_POOL, INVITE_ADDRESS_DAILY_LIMIT, INVITE_SENDER_DAILY_LIMIT, POOL_DAILY_LIMIT,
  emailSkippedEvent, inviteSenderName, sendInviteEmail,
} from '../../../_email.js';
import { DAY_MS, hitRateLimit, peekRateLimit } from '../../../_ratelimit.js';
import { readJsonBody } from '../../../_request.js';
import { jsonError, normalizeEmail, requireUser, sha256Hex, writeLog } from '../../../_shared.js';
import { CAN_OPEN, canOpenParams } from '../../../_shares.js';

const MAX_PEOPLE_PER_PAGE = 25;
// Rows as well as mail: past the mail limit, a spammer could still fill
// strangers' "Shared with me" lists, one new page every 25 people.
const SHARES_PER_SENDER_PER_DAY = 20;
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_TOO_MANY_REQUESTS = 429;

function notFound() {
  return new Response(null, { status: HTTP_NOT_FOUND });
}

function db(env) {
  return env.lyricalmiracle_db;
}

function findOpenable(env, id, user) {
  return db(env).prepare(
    `SELECT id, title, user_id FROM lyrics WHERE id = ? AND ${CAN_OPEN}`
  ).bind(id, ...canOpenParams(user)).first();
}

function readEmail(body) {
  const email = body && typeof body.email === 'string' ? body.email.trim() : '';
  const normalized = normalizeEmail(email);
  return normalized && LOOKS_LIKE_EMAIL.test(normalized) ? { email, normalized } : null;
}

// The link the sender can pass on by hand when no mail went. It only goes
// back to the sender's own screen, never into a mail, so the site they are on
// is the right one to point at.
function pageLink(request, id) {
  return `${new URL(request.url).origin}/#shared=${id}`;
}

export async function onRequestGet({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const lyric = await findOpenable(env, params.id, user);
  if (!lyric) return notFound();

  const [owner, shares] = await Promise.all([
    db(env).prepare('SELECT name, email FROM users WHERE id = ?').bind(lyric.user_id).first(),
    db(env).prepare(`
      SELECT email, first_opened_at IS NOT NULL AS joined FROM lyric_shares
      WHERE lyric_id = ? ORDER BY created_at
    `).bind(lyric.id).all(),
  ]);

  return Response.json({
    role: lyric.user_id === user.id ? 'owner' : 'editor',
    owner: { name: owner.name || '', email: owner.email },
    people: shares.results.map(row => ({ email: row.email, joined: Boolean(row.joined) })),
  });
}

// Whether the invite mail can go today, peeked without counting. A full pool
// must not burn the sender's or the address's allowance on mail that never
// went, so all three are counted only once all three have room.
async function inviteMailRoom(env, user, addressHash) {
  const limits = [
    [`email:invite:sender:${user.id}`, INVITE_SENDER_DAILY_LIMIT, 'sender'],
    [`email:invite:addr:${addressHash}`, INVITE_ADDRESS_DAILY_LIMIT, 'address'],
    [`email:pool:${EMAIL_POOL.INVITE}`, POOL_DAILY_LIMIT.invite, 'pool'],
  ];
  for (const [key, limit, reason] of limits) {
    if (!(await peekRateLimit(env, key, limit, DAY_MS)).allowed) return { reason };
  }
  return { keys: limits.map(([key]) => key) };
}

function isSuppressed(env, addressHash) {
  return db(env).prepare('SELECT 1 FROM email_suppressions WHERE address_hash = ?')
    .bind(addressHash).first();
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  // Only the owner shares. An editor gets the same 404 as a stranger.
  const lyric = await db(env).prepare('SELECT id, title FROM lyrics WHERE id = ? AND user_id = ?')
    .bind(params.id, user.id).first();
  if (!lyric) return notFound();

  const target = readEmail(await readJsonBody(request));
  if (!target) return jsonError(HTTP_BAD_REQUEST, 'invalid_email', "That doesn't look like an email address.");
  if (target.normalized === user.email_normalized) {
    return jsonError(HTTP_BAD_REQUEST, 'own_email', "That's your own address.");
  }

  const [existing, count] = await Promise.all([
    db(env).prepare('SELECT 1 FROM lyric_shares WHERE lyric_id = ? AND email_normalized = ?')
      .bind(lyric.id, target.normalized).first(),
    db(env).prepare('SELECT count(*) AS n FROM lyric_shares WHERE lyric_id = ?').bind(lyric.id).first(),
  ]);
  if (existing) return Response.json({ status: 'already_shared', email: target.email });
  if (count.n >= MAX_PEOPLE_PER_PAGE) {
    return jsonError(HTTP_CONFLICT, 'page_full', `A page can be shared with ${MAX_PEOPLE_PER_PAGE} people at most.`);
  }

  const rowsKey = `share:rows:${user.id}`;
  if (!(await peekRateLimit(env, rowsKey, SHARES_PER_SENDER_PER_DAY, DAY_MS)).allowed) {
    return jsonError(HTTP_TOO_MANY_REQUESTS, 'rate_limited', "You've shared a lot today. Try again tomorrow.");
  }

  const addressHash = await sha256Hex(target.normalized);
  const [account, suppressed] = await Promise.all([
    db(env).prepare('SELECT id FROM users WHERE email_normalized = ?').bind(target.normalized).first(),
    isSuppressed(env, addressHash),
  ]);
  const room = suppressed ? { reason: 'suppressed' } : await inviteMailRoom(env, user, addressHash);
  const willMail = Boolean(room.keys);

  const added = await db(env).prepare(`
    INSERT INTO lyric_shares
      (lyric_id, email_normalized, email, user_id, had_account, emailed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lyric_id, email_normalized) DO NOTHING
  `).bind(lyric.id, target.normalized, target.email, account ? account.id : null,
    account ? 1 : 0, willMail ? 1 : 0, Date.now()).run();
  if (added.meta.changes === 0) return Response.json({ status: 'already_shared', email: target.email });

  await hitRateLimit(env, rowsKey, DAY_MS);
  await writeLog(env, request, { userId: user.id, event: 'share_sent' });

  if (willMail) {
    for (const key of room.keys) await hitRateLimit(env, key, DAY_MS);
    context.waitUntil(sendInviteEmail(context, {
      to: target.email,
      senderName: inviteSenderName(user),
      title: lyric.title,
      lyricId: lyric.id,
      hasAccount: Boolean(account),
    }));
  } else if (room.reason === 'pool' || room.reason === 'address') {
    await writeLog(env, request, { userId: user.id, event: emailSkippedEvent(room.reason, EMAIL_POOL.INVITE) });
  } else if (room.reason === 'sender') {
    await writeLog(env, request, { userId: user.id, event: 'email_skipped_sender' });
  }

  // The same answer whether or not the address has an account, so this box
  // can't test which emails are signed up. An opted-out address reads as
  // emailed too: whether someone opted out is theirs to keep.
  return Response.json({
    status: 'shared',
    email: target.email,
    emailed: willMail || room.reason === 'suppressed',
    link: pageLink(request, lyric.id),
  });
}

// The owner removes anyone; an editor can only remove themselves ("Leave").
// The address rides in the body, not the URL, so it stays out of request logs.
export async function onRequestDelete({ request, env, params }) {
  const { user, response } = await requireUser(request, env);
  if (response) return response;

  const lyric = await findOpenable(env, params.id, user);
  if (!lyric) return notFound();

  const target = readEmail(await readJsonBody(request));
  if (!target) return jsonError(HTTP_BAD_REQUEST, 'invalid_email', "That doesn't look like an email address.");
  const isOwner = lyric.user_id === user.id;
  if (!isOwner && target.normalized !== user.email_normalized) return notFound();

  await db(env).prepare('DELETE FROM lyric_shares WHERE lyric_id = ? AND email_normalized = ?')
    .bind(lyric.id, target.normalized).run();
  return new Response(null, { status: 204 });
}
