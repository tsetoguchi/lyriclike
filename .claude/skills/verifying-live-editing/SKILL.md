---
name: verifying-live-editing
description: Use when a change touches LyricLike live co-editing or sharing - the collab room Worker, live-*.js, presence carets and chips, shared pages, the LIVE_EDITING switch, or paused read-only pages - and needs checking with two signed-in people before a PR
---

# Verifying live editing

## Overview

Two servers run: the room Worker (`collab/`, port 8787) and the site (8788),
which reaches the room through its `PAGE_ROOM` binding. Two browser windows
with separate cookies play Ann (owner) and Bo (co-writer) on `smoke-page`.

**REQUIRED:** read `running-lyriclike-locally` first. Its sign-in seed makes
Ann, Bo and the shared page.

## Set up

1. Start the room first, in the background. Starting both at once gives
   `SQLITE_BUSY`:
   ```bash
   cd collab && npx --yes wrangler@4.131.2 dev --persist-to ../.wrangler/state
   ```
   Wait for `Ready on http://127.0.0.1:8787`.
2. Load the seed (`tools/live-smoke-seed.sql`).
3. Start the site with the switch on:
   ```bash
   npx --yes wrangler@4.131.2 pages dev . --port 8788 --binding LIVE_EDITING=on
   ```
   Its startup table must show `env.PAGE_ROOM ... [connected]`. If it says
   `[not connected]`, the room isn't running.
4. Open a second window for Bo. Each `browser_run_code_unsafe` call starts
   fresh, so find Bo's page through the browser every time:
   ```js
   // once
   const ctxB = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
   await ctxB.newPage();
   await page.context().addCookies([{ name: 'sid', value: 'smoke-token-ann', domain: 'localhost', path: '/' }]);
   await ctxB.addCookies([{ name: 'sid', value: 'smoke-token-bo', domain: 'localhost', path: '/' }]);
   // every later call
   const bo = page.context().browser().contexts().find(c => c !== page.context()).pages()[0];
   ```

## Reset between runs

The room keeps its own copy of each page, so reseeding the database alone
leaves the old text. In this order:

1. Close Bo's window and send Ann's to `about:blank`. An open tab pushes
   its text back into the room when it reconnects.
2. Stop both servers (see `running-lyriclike-locally`; check 8787 and 8788).
3. Delete `.wrangler/state/v3/do/lyricalmiracle-collab-PageRoom`.
4. Rerun the seed, start the room, wait for Ready, start the site.

## Run through (switch on)

1. **Open.** Both go to `/`. Ann's list shows Smoke and Solo. Bo's shows
   "Shared with me", Smoke, Ann. Both click Smoke (`#lyrics-list-items`
   `getByText('Smoke', { exact: true })`). Both editors read `hello`.
2. **Presence.** `#page-presence` reads "B鈴 here now" for Ann and "A here
   now" for Bo. Ann sees a Share button.
3. **Ann types.** Click `#lyrics`, `Control+End`, type ` from Ann`. Bo's
   `#lyrics` and `#lyrics-highlight` show it within about a second. Poll
   every 100ms rather than waiting a fixed time.
4. **Bo types** a new line. Ann sees it, plus Bo's coloured caret
   (`#presence-over` has a child).
5. **Saved.** About 10s later, `GET /api/lyrics/smoke-page` returns the
   joined text. The room writes to the database late on purpose.

## Run through (switch off)

Stop only the site (node processes whose command line has `pages dev`),
leave the room running, and restart the site without `--binding
LIVE_EDITING=on`.

1. Bo opens Smoke. `#page-notice-text` reads "Live editing is paused. You
   can read this page." and `#lyrics` is read-only.
2. A save from Bo, `PUT /api/lyrics/smoke-page` with
   `{ body, base_revision: <current> }`, answers `403 {"error":"paused"}`.
   A wrong `base_revision` gives 409 instead, which proves nothing.
3. `/api/me` for Bo has `can_share: false`.

Screenshot both windows into `.playwright-mcp/`.

## Faster check without a browser

`node tools/live-smoke.mjs` runs two socket clients against both servers.
Use it after room changes. It doesn't show anything on screen.

- Warm the room first: the first few connections after the room starts get
  a 500 ("Network connection lost"). The browser retries; the script
  doesn't. Open Smoke once in the browser, close it, then run the script.
- Expect five `ok` lines (sync, relay, persisted, write-back, last-leaver
  write-back) and `FAIL timed out: old protocol closed`. That last one
  always fails locally, because close codes don't arrive (see below).

## Common mistakes

| Symptom | Cause |
|---|---|
| Typing never reaches the other window | Site started before the room, or `LIVE_EDITING` not set. Page falls back to polling |
| Old text after a reset | The room kept its copy, or an open tab pushed it back. Follow "Reset between runs" |
| Console shows `WebSocket ... failed` a few times, then works | Cold room start. Normal locally |
| `bo` is undefined | Variables don't survive between run-code calls. Look it up again |
| Close codes (4001, 4004...) never arrive locally | Known: the local two-process proxy drops them. Check on the preview site |

## Hand to the user

The room on Cloudflare and iPhone Safari behave differently from local:
iOS keeps a dead socket looking open after the phone sleeps. For changes to
connecting, reconnecting or presence, ask the user to test on the preview
site with two accounts, one on their iPhone. Tell them to type the URL into
Safari: links opened from the Claude app use its own browser and cookies.
