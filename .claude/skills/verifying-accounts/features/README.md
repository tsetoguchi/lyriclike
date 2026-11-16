# Accounts feature map

One file per thing a person does with their account. Read this index, then
use the matching file as the recipe. Server bindings, the seed script and
common mistakes live in `../SKILL.md`.

## Baseline

- Site running on port 8788 with the password bindings from `../SKILL.md`.
- `seed-accounts.mjs` output loaded: `pat@local.test` (confirmed) and
  `sam@local.test` (pending). Password `lyric-test-pass-42`.
- Cookies and `localStorage` cleared.

## Proof rules

- Capture the screen after each step, plus `/api/me` as a second view.
- Screenshots go in `.playwright-mcp/<feature>/`. Cleanup never deletes it.
- Rerun the seed between features that change a password or use a link.

## Features

- [Password log in](./password-log-in.md): email step, wrong and right
  password, mixed-case email, sign out.
- [Save a page](./save-a-page.md): create a titled page and see it again
  after logging back in.
- [Confirm email link](./confirm-email-link.md): finish a sign-up from the
  email link, and the used-link message.
- [Reset password link](./reset-password-link.md): set a new password from
  the email link.

## Not coverable locally

- Sending the sign-up and reset emails, and Turnstile. Check on the real
  site.
