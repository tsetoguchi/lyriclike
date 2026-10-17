// Writes local-only SQL for checking password accounts, since Turnstile always
// fails locally and no email is sent. Makes a confirmed user, a pending
// signup and a reset token, each with a known token, and prints the links an
// email would have held. Never run the SQL against a remote database.
//
//   node .claude/skills/verifying-accounts/seed-accounts.mjs <out.sql>
import { writeFileSync } from 'node:fs';

import { hashPassword } from '../../../functions/_password.js';
import { sha256Hex } from '../../../functions/_shared.js';

// Must match the PASSWORD_PEPPER binding the local server was started with.
export const LOCAL_PEPPER = 'local-test-pepper-not-a-secret';
const SITE = 'http://localhost:8788';
const PASSWORD = 'lyric-test-pass-42';
const USER = { id: 'local-pat', email: 'pat@local.test', name: 'Pat' };
const PENDING_EMAIL = 'sam@local.test';
const CONFIRM_TOKEN = 'c'.repeat(64);
const RESET_TOKEN = 'e'.repeat(64);
const HOUR_MS = 60 * 60 * 1000;

const quote = value => `'${String(value).replace(/'/g, "''")}'`;

async function buildSql(passwordHash, now) {
  const later = now + HOUR_MS;
  return `
DELETE FROM reset_tokens WHERE user_id = ${quote(USER.id)};
DELETE FROM sessions WHERE user_id = ${quote(USER.id)};
DELETE FROM lyrics WHERE user_id = ${quote(USER.id)};
DELETE FROM users WHERE id = ${quote(USER.id)} OR email_normalized = ${quote(PENDING_EMAIL)};
DELETE FROM pending_signups WHERE email_normalized IN (${quote(USER.email)}, ${quote(PENDING_EMAIL)});
DELETE FROM rate_limits;
INSERT INTO users (id, email, email_normalized, name, password_hash, password_updated_at, created_at)
  VALUES (${quote(USER.id)}, ${quote(USER.email)}, ${quote(USER.email)}, ${quote(USER.name)},
    ${quote(passwordHash)}, ${now}, ${now});
INSERT INTO pending_signups (token_hash, email, email_normalized, name, password_hash, expires_at, created_at)
  VALUES (${quote(await sha256Hex(CONFIRM_TOKEN))}, ${quote(PENDING_EMAIL)}, ${quote(PENDING_EMAIL)},
    'Sam', ${quote(passwordHash)}, ${later}, ${now});
INSERT INTO reset_tokens (token_hash, user_id, email_normalized, expires_at, created_at)
  VALUES (${quote(await sha256Hex(RESET_TOKEN))}, ${quote(USER.id)}, ${quote(USER.email)}, ${later}, ${now});
`;
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath) throw new Error('usage: seed-accounts.mjs <out.sql>');

  const passwordHash = await hashPassword(PASSWORD, { PASSWORD_PEPPER: LOCAL_PEPPER });
  writeFileSync(outPath, await buildSql(passwordHash, Date.now()));
  console.log(`Wrote ${outPath}. Password for both accounts: ${PASSWORD}`);
  console.log(`Log in:          ${USER.email}`);
  console.log(`Confirm signup:  ${SITE}/#signup_token=${CONFIRM_TOKEN}  (${PENDING_EMAIL})`);
  console.log(`Reset password:  ${SITE}/#reset_token=${RESET_TOKEN}  (${USER.email})`);
}

await main();
