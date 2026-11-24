# Confirm email link

A person who signed up opens the link from their email, enters the
password they chose, and is signed in. Opening the link again says it was
already used.

## Sub-features

- `confirm-open` shows "Almost done" from the link.
- `confirm-wrong` refuses a password that isn't the sign-up one.
- `confirm-submit` signs the person in.
- `confirm-used` explains an already-used link, signed in or out.

## How to get to it (user POV)

- Click the confirm link in the sign-up email.

## Driving it with Playwright MCP

Preconditions:

- Fresh seed (Sam pending). Cookies cleared.

- **Open.** Go to `/#signup_token=` followed by 64 `c`s. The fragment
  leaves the address bar. `#auth-title` reads "Almost done",
  `#auth-message` "Enter your password to finish signing up.", and
  `#auth-submit` "Finish signing up".
- **Wrong.** Submit any other password. `#auth-error` reads "That isn't
  the password you signed up with."
- **Submit.** Enter `lyric-test-pass-42`. The box closes. `/api/me` is
  Sam.
- **Used, signed in.** Stay signed in, open the same link again and
  submit. The form hides and `#auth-message` reads "That link was already
  used. You're signed in."
- **Used, signed out.** Clear cookies, open it again and submit. It reads
  "That link has expired or was already used. Sign up again." with a
  "Sign up again" button (`[data-auth-link=sign-up-again]`).
- **Proof.** Screenshots to `.playwright-mcp/confirm-email-link/`.

## Gotchas

- The real sign-up form can't finish locally (Turnstile test keys fail the
  hostname check). Use the seeded pending sign-up.
- "Confirm your email" is the email's subject, not the dialog's title.
- Five wrong passwords delete the pending sign-up. Rerun the seed.
