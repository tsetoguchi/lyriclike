# Change password

A signed-in person with a password changes it from the account menu. The
old one stops working and they stay signed in.

## Sub-features

- `change-open` opens the password box from the account menu.
- `change-wrong` refuses a wrong current password.
- `change-save` saves the new one and says other devices were signed out.

## How to get to it (user POV)

- Account avatar, then "Change password". An account with no password
  (Google or Apple only) sees "Add a password" instead, which emails a
  link. That email can't be checked locally.

## Driving it with Playwright MCP

Preconditions:

- Fresh seed, logged in as Pat.

- **Open.** Click `#account-settings-btn`, then `#change-password-btn`.
  `#password-overlay` gets `open`.
- **Wrong.** Fill `#current-password` with a wrong one and `#new-password`
  with `changed-pass-55-kv`, then click `#save-password-btn`.
  `#security-error` reads "That password isn't right."
- **Save.** Current `lyric-test-pass-42`, same new one. The box closes and
  a dialog reads "Password changed" and "Any other devices were signed
  out." Click `#dialog-confirm`. `/api/me` is still Pat.
- **Old dead.** A login POST with the old password gets 401. The new one
  gets 200.
- **Proof.** Screenshots to `.playwright-mcp/change-password/`.

## Gotchas

- This changes Pat's password. Rerun the seed before other features.
