# Delete account

A signed-in person deletes their account from the account menu. With a
password they give it again, and a wrong one asks again.

## Sub-features

- `delete-ask` asks for the password before deleting.
- `delete-wrong` asks again, with a note, on a wrong password.
- `delete-done` deletes the account and signs out.

## How to get to it (user POV)

- Account avatar, then "Delete account". An account with no password types
  its email instead (or DELETE, with Sign in with Apple).

## Driving it with Playwright MCP

Preconditions:

- Fresh seed, logged in as Pat.

- **Ask.** Click `#account-settings-btn`, then
  `#settings-delete-account-btn`. A "Delete account" dialog says "This
  deletes your account and every page saved to it. It cannot be undone.
  Enter your password to confirm."
- **Wrong.** Fill `#dialog-input` with a wrong password and click
  `#dialog-confirm`. The dialog stays, now starting "That password isn't
  right."
- **Done.** Fill the right password and confirm. `/api/me` is 401, "Log
  in" shows, and a login POST as Pat gets 401.
- **Proof.** Screenshots to `.playwright-mcp/delete-account/`.

## Gotchas

- Pat is gone afterwards. Rerun the seed to bring Pat back.
