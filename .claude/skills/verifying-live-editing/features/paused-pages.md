# Paused pages

When live editing is switched off, a co-writer can still read a shared
page but can't change it, and sharing is off.

## Sub-features

- `paused-notice` shows the paused message and a read-only editor.
- `paused-save` refuses saves with `403 paused`.
- `paused-share` turns sharing off for the account.

## How to get to it (user POV)

- Co-writer opens a shared page while live editing is off.

## Driving it with Playwright MCP

Preconditions:

- Room still running. Site restarted without `--binding LIVE_EDITING=on`
  (stop only the `pages dev` node processes).

- **Notice.** Bo opens Smoke. `#page-notice-text` reads "Live editing is
  paused. You can read this page." and `#lyrics` is read-only.
- **Save refused.** As Bo, `PUT /api/lyrics/smoke-page` with
  `{ body, base_revision: <current> }` answers `403 {"error":"paused"}`.
- **Sharing off.** Bo's `/api/me` has `can_share: false`.
- **Proof.** Screenshot Bo's window to
  `.playwright-mcp/paused-pages/notice.png`.

## Gotchas

- A wrong `base_revision` gives 409, which proves nothing. Read the current
  revision first.
