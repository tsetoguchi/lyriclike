# Reset password link

A person who forgot their password opens the reset link from their email,
sets a new one, and is signed in. The old password stops working.

## Sub-features

- `reset-open` shows "Set a new password" from the link.
- `reset-submit` saves the new password and signs in.
- `reset-old-dead` makes the old password fail.

## How to get to it (user POV)

- Click the reset link in the password reset email.

## Driving it with Playwright MCP

Preconditions:

- Fresh seed. Cookies cleared.

- **Open.** Go to `/#reset_token=` followed by 64 `e`s. Title reads "Set a
  new password".
- **Submit.** Enter a new password. Signed in as Pat.
- **Old dead.** A login POST with `lyric-test-pass-42` gets 401. The new
  password gets 200.
- **Proof.** Screenshots to `.playwright-mcp/reset-password-link/`.

## Gotchas

- This changes Pat's password. Rerun the seed before other features.
