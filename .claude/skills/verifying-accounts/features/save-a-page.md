# Save a page

A signed-in person creates a page, names it, writes in it, and finds it
again after signing out and back in.

## Sub-features

- `save-create` makes a blank page, with no title prompt.
- `save-title` names the page from its title line.
- `save-autosave` saves typed text to the account.
- `save-return` opens the page and its text after logging back in.

## How to get to it (user POV)

- Signed in, click "Create page" in the sidebar. At phone width the
  sidebar is a drawer, and the start screen has its own "Create".

## Driving it with Playwright MCP

Preconditions:

- Logged in as Pat (see `password-log-in.md`). Pat starts with no pages:
  `/api/lyrics` is `[]` and `#lyrics-list-items` reads "You have no pages".

- **Create.** Click `#new-lyric-btn`. No dialog opens (`#dialog-overlay`
  stays hidden). The title `#lyrics-panel-title` is blank and focused.
  The page is saved at once, empty: within a second or two `/api/lyrics`
  lists it as "Untitled" with `is_empty: 1`.
- **Title.** Type a title and press Enter. Focus moves to the words.
- **Write.** Type a line. It saves about 1 second later; wait 2-3 seconds.
- **Saved.** `GET /api/lyrics` lists the page with its title and
  `is_empty: 0`. The list has no words, so check them with
  `GET /api/lyrics/<id>`: its `body` is the typed line.
- **Sign out, sign in.** Sign out, then log in as Pat again. The newest
  page opens by itself with the typed line, and its title is in
  `#lyrics-list-items`.
- **Proof.** Screenshots to `.playwright-mcp/save-a-page/`.

## Gotchas

- Signed out, "Create page" opens the sign-up box instead.
- If an empty "Untitled" page already exists, "Create page" reopens it
  instead of making another.
