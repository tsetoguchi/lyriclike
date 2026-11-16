# Confirm email link

A person who signed up opens the link from their email, enters the
password they chose, and is signed in. Opening the link again says it was
already used.

## Sub-features

- `confirm-open` shows "Confirm your email" from the link.
- `confirm-submit` signs the person in.
- `confirm-used` explains an already-used link.

## How to get to it (user POV)

- Click the confirm link in the sign-up email.

## Driving it with Playwright MCP

Preconditions:

- Fresh seed (Sam pending). Cookies cleared.

- **Open.** Go to `/#signup_token=` followed by 64 `c`s. Title reads
  "Confirm your email" and asks for the sign-up password.
- **Submit.** Enter `lyric-test-pass-42`. The box closes. `/api/me` is
  Sam.
- **Used.** Open the same link again and submit. It reads "That link was
  already used. You're signed in."
- **Proof.** Screenshots to `.playwright-mcp/confirm-email-link/`.

## Gotchas

- The real sign-up form can't finish locally (Turnstile test keys fail the
  hostname check). Use the seeded pending sign-up.
