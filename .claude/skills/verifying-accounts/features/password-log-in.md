# Password log in

A person with an account logs in with email and password, sees a clear
message on a wrong password, and can sign out.

## Sub-features

- `login-email` asks for the email, then the password.
- `login-wrong` shows the wrong-password message.
- `login-right` closes the box and signs in.
- `login-case` accepts the email in any capitals.
- `login-out` signs out from the account menu.

## How to get to it (user POV)

- Click "Log in" in the top bar.
- Sign out: account avatar, then Sign out.

## Driving it with Playwright MCP

Preconditions:

- Baseline from the README.

- **Open.** Click `#sign-in-btn`. The box reads "Log in or sign up".
- **Email.** Fill `#auth-email` with `pat@local.test`, click
  `#auth-submit`. Title becomes "Enter your password".
- **Wrong.** Submit a wrong password. `#auth-error` reads "That password
  isn't right. Try again or reset it."
- **Right.** Submit `lyric-test-pass-42`. The box closes. `/api/me`
  returns Pat.
- **Sign out.** Click `#account-settings-btn`, then
  `#settings-sign-out-btn`. `/api/me` is 401 and the editor is empty.
- **Mixed case.** Log in again as `PAT@Local.test`. `/api/me` returns Pat.
- **Proof.** Screenshots of each box to
  `.playwright-mcp/password-log-in/`.

## Gotchas

- Every password wrong means the server pepper doesn't match the seed.
- 429 answers are rate limits. Rerun the seed.
- Only a Google button means `PASSWORD_AUTH_ENABLED` is missing.
