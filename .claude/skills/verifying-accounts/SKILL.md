---
name: verifying-accounts
description: Use when a change touches LyricLike sign-in, sign-up, email confirm links, password reset, sign-out, account settings, or saving pages to an account, and needs checking in a real browser before a PR
---

# Verifying accounts

## Overview

Locally, the sign-up form can't finish: Cloudflare's Turnstile test keys
always fail the server's hostname check, and no email is sent. So
`seed-accounts.mjs` writes the rows a real sign-up and email would make,
with known tokens. Then the browser tests everything after the email.

**REQUIRED:** follow `running-lyriclike-locally` first, but start the server
with password accounts on (below).

## Set up

1. Write and load the test accounts. Put the SQL in your scratchpad:
   ```bash
   node .claude/skills/verifying-accounts/seed-accounts.mjs <scratchpad>/accounts-seed.sql
   npx --yes wrangler@4.131.2 d1 execute lyricalmiracle_db --local --file <scratchpad>/accounts-seed.sql
   ```
   It prints the password (`lyric-test-pass-42`) and both links. Rerun both
   commands to reset; it also clears local rate limits.
2. Start the site with these bindings. The pepper must match the script's
   `LOCAL_PEPPER`, or every password is "wrong":
   ```bash
   npx --yes wrangler@4.131.2 pages dev . --port 8788 \
     --binding PASSWORD_AUTH_ENABLED=true \
     --binding PASSWORD_PEPPER=local-test-pepper-not-a-secret \
     --binding APP_BASE_URL=http://localhost:8788 \
     --binding TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA \
     --binding TURNSTILE_SITE_KEY=1x00000000000000000000AA
   ```
3. `/api/auth/methods` should answer `{"password":true,...}`.

| Account | State |
|---|---|
| `pat@local.test` | Confirmed, has a password, no pages |
| `sam@local.test` | Pending: signed up, email not confirmed |

## Run through

Start with cookies and `localStorage` cleared.

1. **Log in.** `#sign-in-btn` opens "Log in or sign up". Fill `#auth-email`
   with `pat@local.test`, click `#auth-submit`. Title becomes "Enter your
   password".
2. **Wrong password.** `#auth-error` reads "That password isn't right. Try
   again or reset it."
3. **Right password.** The box closes. `/api/me` returns Pat.
4. **Save a page.** Signed in, "Create page" (`#new-lyric-btn`) asks for a
   title in `#dialog-input`; click `#dialog-confirm`. Type a line, wait 3s.
   `/api/lyrics` lists the page.
5. **Sign out.** `#account-settings-btn`, then `#settings-sign-out-btn`.
   `/api/me` is 401 and the editor is empty.
6. **Log in again** as `PAT@Local.test` (mixed case). The saved page and its
   text come back.
7. **Confirm link.** Sign out, open
   `/#signup_token=` + 64 `c`s. Title "Confirm your email", asking for the
   sign-up password. Submit it: the box closes and `/api/me` is Sam.
8. **Used link.** Open the same link again and submit. It says "That link
   was already used. You're signed in."
9. **Reset link.** Clear cookies, open `/#reset_token=` + 64 `e`s. Title
   "Set a new password". Submit a new one: signed in as Pat. A login POST
   with the old password gets 401; the new one gets 200.

Screenshot each new screen into `.playwright-mcp/`.

## Common mistakes

| Symptom | Cause |
|---|---|
| Every password is wrong | Server pepper doesn't match `LOCAL_PEPPER` |
| Sign-up form says the security check failed | Expected locally. Use the seeded pending sign-up |
| Click hangs for 30s | A dialog (`.modal-overlay.open`) is covering it, e.g. the Create page title box |
| 429 answers | Rate limits. Rerun the seed |
| Only Google shows | `PASSWORD_AUTH_ENABLED` binding missing |

## Hand to the user

Local runs can't check Turnstile or email delivery. If a change touches
either, ask the user to sign up on lyriclike.com with a real inbox after it
deploys, and say what to look for.
