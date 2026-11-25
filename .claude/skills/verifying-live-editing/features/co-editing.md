# Co-editing

Two people open the same shared page, see who else is there, and see each
other's typing and carets within a second. The text reaches the database
a little later.

## Sub-features

- `live-open` lists the page for both people and opens it.
- `live-presence` shows who is here now, as initials chips.
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
- **Wait for the room.** Before anyone types, poll until both windows'
  `#presence-header` has a chip. On a cold room this takes up to a
  minute: the first sockets fail and the retries back off. Typing before
  then still syncs later, but the timing checks below fail.
- **Presence.** On desktop the chips are in `#presence-header`: Ann sees
  one chip "B鈴" (title "Bö 鈴木", aria-label "Here now: Bö 鈴木"), Bo
  sees "A" ("Here now: Ann"). `#page-presence` adds a "here now" note,
  but only on phones (768px wide or less). On desktop it is hidden and
  its text runs together ("B鈴here now").
  `#share-btn` reads "Share" for Ann and "People" for Bo.
- **Ann types.** `#lyrics`, `Control+End`, type ` from Ann`. Poll Bo's
  `#lyrics` every 100ms; it shows the text within about a second.
- **Bo types** a new line. Ann sees it, and `#presence-over` has a
  `.presence-caret` whose `.presence-tag` reads "Bö 鈴.". The caret only
  shows while Bo's editor has focus.
- **Saved.** The room writes to the database every 10s, so poll
  `GET /api/lyrics/smoke-page` every second for up to 15s. It returns the
  joined text, `role: "owner"` and `live: true` for Ann, and
  `role: "editor"` for Bo.
- **Proof.** Screenshots of both windows to
  `.playwright-mcp/co-editing/`.

## Gotchas

- Look Bo's page up again in every run-code call. Variables don't survive.
- Up to about a dozen `WebSocket ... failed` errors on a cold room are
  normal locally.
- After a cold start, "Offline, changes will sync" can stay up while
  typing already syncs. It clears when that person types. Don't read it
  as a failure.
- Close codes never arrive locally. Check those on the preview site.
