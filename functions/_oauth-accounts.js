// Which account an outside sign-in (Google, Apple) belongs to. Each provider
// hands over a verified identity: a subject that is theirs alone, and maybe an
// address. This finds the account, links one, or makes one.
//
// A profile is { email, name, emailNormalized, emailVerified, canCompareEmail }.
// canCompareEmail is false when the address says nothing about the stored one,
// as with Apple's private relay addresses, so the "address differs" log is
// skipped.

import { findUserByEmail, issueResetToken } from './_accounts.js';
import { sendProviderAddedEmail } from './_email.js';
import { runInBackground } from './_request.js';
import { claimShares } from './_shares.js';
import { writeLog } from './_shared.js';

function sql(env, text) {
  return env.lyricalmiracle_db.prepare(text);
}

function findIdentityUser(env, provider, subject) {
  return sql(env, `
    SELECT users.id, users.email_normalized FROM identities
    JOIN users ON users.id = identities.user_id
    WHERE identities.provider = ? AND identities.provider_subject = ?
  `).bind(provider, subject).first();
}

function insertIdentity(env, provider, userId, subject) {
  return sql(env, `
    INSERT INTO identities (id, user_id, provider, provider_subject, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId, provider, subject, Date.now());
}

function insertUser(env, userId, { email, emailNormalized, name }) {
  return sql(env, `
    INSERT INTO users (id, email, email_normalized, name, created_at) VALUES (?, ?, ?, ?, ?)
  `).bind(userId, email, emailNormalized, name || null, Date.now());
}

// Someone we already know signs in again, whatever the provider says about the
// address now. The stored email is never overwritten from the provider: it
// could be another account's address, and changing it is not something this
// sign-in gets to do.
async function signInKnownIdentity(env, request, known, profile) {
  if (profile.name) {
    await sql(env, 'UPDATE users SET name = ? WHERE id = ?').bind(profile.name, known.id).run();
  }
  const canCompare = profile.canCompareEmail !== false;
  if (canCompare && known.email_normalized !== profile.emailNormalized) {
    await writeLog(env, request, { userId: known.id, event: 'oauth_email_differs' });
  }
  await writeLog(env, request, { userId: known.id, event: 'login' });
  return known.id;
}

// Tells the owner of a password account that a provider sign-in was added,
// with a reset link in case it was not them.
async function notifyProviderAdded(context, local, provider) {
  const token = await issueResetToken(context.env, local.id, local.email_normalized);
  await sendProviderAddedEmail(context, { to: local.email, token, provider });
}

// A local account holds this address and has no identity from this provider
// yet. Every local account has a proven email, so adding the identity hands
// the account to the one person who controls that mailbox.
async function linkToLocalAccount(context, provider, local, subject) {
  const { env, request } = context;
  await insertIdentity(env, provider, local.id, subject).run();
  await writeLog(env, request, { userId: local.id, event: 'oauth_linked' });
  if (local.password_hash) {
    runInBackground(context, `${provider} added email`, () => notifyProviderAdded(context, local, provider));
  }
  return local.id;
}

async function createOauthUser(env, request, provider, profile, subject) {
  const userId = crypto.randomUUID();
  await env.lyricalmiracle_db.batch([
    insertUser(env, userId, profile),
    insertIdentity(env, provider, userId, subject),
  ]);
  await writeLog(env, request, { userId, event: 'signup' });
  await claimShares(env, request, userId, profile.emailNormalized);
  return userId;
}

// Works out which account this sign-in belongs to and returns its id, or null
// when the provider has not verified the address and there is no identity yet
// to vouch for the person instead.
export async function resolveOauthUser(context, provider, profile, subject) {
  const { env, request } = context;
  const known = await findIdentityUser(env, provider, subject);
  if (known) return signInKnownIdentity(env, request, known, profile);
  if (!profile.emailVerified || !profile.emailNormalized) return null;

  const local = await findUserByEmail(env, profile.emailNormalized);
  try {
    return local
      ? await linkToLocalAccount(context, provider, local, subject)
      : await createOauthUser(env, request, provider, profile, subject);
  } catch (err) {
    // A concurrent sign-in for the same person got there first, so the identity
    // or the address is now taken. Whatever it made is what this request wants.
    const raced = await findIdentityUser(env, provider, subject)
      || await findUserByEmail(env, profile.emailNormalized);
    if (!raced) throw err;
    return raced.id;
  }
}
