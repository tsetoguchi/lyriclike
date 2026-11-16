# Co-editing

Two people open the same shared page, see who else is there, and see each
other's typing and carets within a second. The text reaches the database
a little later.

## Sub-features

- `live-open` lists the page for both people and opens it.
- `live-presence` shows who is here now.
- `live-typing` shows each person's typing to the other.
- `live-caret` shows the other person's coloured caret.
- `live-persist` saves the joined text to the database.

## How to get to it (user POV)

- Owner: pick the page in the sidebar list.
- Co-writer: pick it under "Shared with me".

## Driving it with Playwright MCP

Preconditions:

- Site started with `--binding LIVE_EDITING=on`; its startup table shows
  `env.PAGE_ROOM ... [connected]`.
- Fresh reset (see `../SKILL.md`): both editors start at `hello`.

- **Open.** Both go to `/`. Ann's list shows Smoke and Solo; Bo's shows
  "Shared with me", Smoke, Ann. Both click Smoke in `#lyrics-list-items`.
  Both editors read `hello`.
- **Presence.** `#page-presence` names the other person and "here now".
  Ann sees `#share-btn`.
- **Ann types.** `#lyrics`, `Control+End`, type ` from Ann`. Poll Bo's
  `#lyrics` every 100ms; it shows the text within about a second.
- **Bo types** a new line. Ann sees it, and `#presence-over` has a child
  (Bo's caret).
- **Saved.** About 10s later `GET /api/lyrics/smoke-page` returns the
  joined text.
- **Proof.** Screenshots of both windows to
  `.playwright-mcp/co-editing/`.

## Gotchas

- Look Bo's page up again in every run-code call. Variables don't survive.
- A few `WebSocket ... failed` errors on a cold room are normal locally.
- Close codes never arrive locally. Check those on the preview site.
