# Paused pages

When live editing is switched off, a co-writer can still read a shared
page but can't change it, and sharing is off.

## Sub-features

- `paused-notice` shows the paused message and a read-only editor and
  title.
- `paused-save` refuses saves with `403 paused`.
- `paused-share` turns sharing off for the account.
- `paused-owner` leaves the owner's own page editable.

## How to get to it (user POV)

- Co-writer opens a shared page while live editing is off.

## Driving it with Playwright MCP

Preconditions:

- Room still running. Site restarted with `--binding LIVE_EDITING=off`.
  Leaving the flag out is not enough: `.dev.vars` sets it on.
- Bo's `/api/me` has `can_share: false` before you start.

- **Notice.** Bo opens Smoke. `#page-notice-text` reads "Live editing is
  paused. You can read this page." `#lyrics` has `readOnly` true, typing
  changes nothing, and `#lyrics-panel-title` has `contentEditable`
  "false". Bo still sees "Shared by Ann" and a "People" button.
- **Save refused.** As Bo, `PUT /api/lyrics/smoke-page` with
  `{ body, base_revision: <current> }` answers `403 {"error":"paused"}`.
  A wrong `base_revision` gets the same 403: the paused check runs first.
- **Sharing off.** Bo's `/api/me` has `can_share: false`.
- **Owner.** Ann opens Smoke: no notice, `#lyrics` editable. Her `PUT`
  with a wrong `base_revision` answers 409, not 403.
- **Proof.** Screenshot Bo's window to
  `.playwright-mcp/paused-pages/notice.png`.

## Gotchas

- Only co-writers are paused. A 409 means the request ran as the owner,
  or the switch is still on.
