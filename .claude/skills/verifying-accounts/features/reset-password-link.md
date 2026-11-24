# Reset password link

A person who forgot their password opens the reset link from their email,
sets a new one, and is signed in. The old password stops working.

## Sub-features

- `reset-open` shows "Set a new password" from the link.
- `reset-short` refuses a password under 8 characters.
- `reset-submit` saves the new password and signs in.
- `reset-old-dead` makes the old password fail.
- `reset-used` explains an already-used link.

## How to get to it (user POV)

- Click the reset link in the password reset email.

## Driving it with Playwright MCP

Preconditions:

- Fresh seed. Cookies cleared.

- **Open.** Go to `/#reset_token=` followed by 64 `e`s. `#auth-title`
  reads "Set a new password", the hint "At least 8 characters", and
  `#auth-submit` "Set password".
- **Short.** Submit `short`. `#auth-error` reads "Use at least 8
  characters." Nothing is sent.
- **Submit.** Enter `fresh-reset-pass-77-xq`. The box closes and
  `/api/me` is Pat.
- **Old dead.** `POST /api/auth/login` with `pat@local.test` and
  `lyric-test-pass-42` gets 401. The new password gets 200.
- **Used.** Clear cookies, open the link again and submit. The form hides
  and it reads "That link has expired or was already used. Ask for a new
  one."
- **Proof.** Screenshots to `.playwright-mcp/reset-password-link/`.

## Gotchas

- Use an unusual new password. A common one, like `password123`, is
  refused as found in a data breach.
- This changes Pat's password. Rerun the seed before other features.
