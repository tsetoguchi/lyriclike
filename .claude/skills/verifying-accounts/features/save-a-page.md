# Save a page

A signed-in person creates a titled page, writes in it, and finds it again
after signing out and back in.

## Sub-features

- `save-create` asks for a title and makes the page.
- `save-autosave` saves typed text to the account.
- `save-return` shows the page and its text after logging back in.

## How to get to it (user POV)

- Signed in, click "Create page" in the sidebar.

## Driving it with Playwright MCP

Preconditions:

- Logged in as Pat (see `password-log-in.md`). Pat starts with no pages.

- **Create.** Click `#new-lyric-btn`. Fill `#dialog-input` with a title,
  click `#dialog-confirm`.
- **Write.** Type a line in `#lyrics`. Wait 3 seconds.
- **Saved.** `GET /api/lyrics` lists the page.
- **Sign out, sign in.** Sign out, then log in as Pat again. The page is in
  `#lyrics-list-items` and opens with the typed line.
- **Proof.** Screenshot the reopened page to
  `.playwright-mcp/save-a-page/reopened.png`.

## Gotchas

- Signed out, "Create page" opens the sign-up box instead.
- A click that hangs 30s means the title dialog
  (`.modal-overlay.open`) is still open.
