---
name: verifying-live-editing
description: Use when a change touches LyricLike live co-editing or sharing - the collab room Worker, live-*.js, presence carets and chips, shared pages, the LIVE_EDITING switch, or paused read-only pages - and needs checking with two signed-in people before a PR
---

# Verifying live editing

## Overview

Two servers run: the room Worker (`collab/`, port 8787) and the site (a
free port, usually 8788), which reaches the room through its `PAGE_ROOM`
binding. Two browser windows with separate cookies play Ann (owner) and Bo
(co-writer) on `smoke-page`.

**REQUIRED:** read `running-lyriclike-locally` first. Its sign-in seed makes
Ann, Bo and the shared page.


## Feature map

`features/README.md` lists every feature this guide covers, one file each:
how a user reaches it, how to drive it, and what proves it works. Use it to
cover every entry point, not just the handy one. Keep it in step with the
app.

## Set up

1. Pick a free site port. Other sessions often hold 8788 or 8789, and a
   second server on a held port can still print `Ready` while the browser
   reaches the other one. Check before you start:
   ```powershell
   foreach ($p in 8787,8788,8789,8790,8791) { try { Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop | Out-Null; "$p busy" } catch { "$p free" } }
   ```
   The room must get 8787. The site can use any free port: the room is
   found by name, not port. `<port>` below is the one you picked.
2. Copy `.dev.vars` into a new worktree, then start the room first, in the
   background. Starting both at once gives `SQLITE_BUSY`:
   ```bash
   cd collab && npm ci && npx --yes wrangler@4.131.2 dev --persist-to ../.wrangler/state
   ```
   Wait for `Ready on http://127.0.0.1:8787`.
3. Apply migrations and load the seed (`running-lyriclike-locally`).
4. Start the site with the switch on:
   ```bash
   npx --yes wrangler@4.131.2 pages dev . --port <port> --binding LIVE_EDITING=on
   ```
   Its startup table must show `env.PAGE_ROOM ... [connected]`. If it says
   `[not connected]`, the room isn't running.
5. Open a second window for Bo. Set the first-visit keys in both before
   the first load: on a fresh browser the tour ("Syllables and rhymes")
   and Ann's "Write together" card cover the page and swallow clicks.
   Each `browser_run_code_unsafe` call starts fresh, so find Bo's page
   through the browser every time:
   ```js
   // once
   const seen = () => { localStorage.tour_seen = '1'; localStorage.sample_seen = '1'; localStorage.whats_new_seen = 'live-editing'; };
   const ctxB = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
   await ctxB.newPage();
   await page.context().addInitScript(seen);
   await ctxB.addInitScript(seen);
   await page.context().addCookies([{ name: 'sid', value: 'smoke-token-ann', domain: 'localhost', path: '/' }]);
   await ctxB.addCookies([{ name: 'sid', value: 'smoke-token-bo', domain: 'localhost', path: '/' }]);
   // every later call
   const bo = page.context().browser().contexts().find(c => c !== page.context()).pages()[0];
   ```
   Ann's window is the main context and keeps storage from earlier
   sessions. Clear it first, as in Reset step 1: an old draft there gets
   saved as an extra page.

Two console errors and one warning are normal on every load: a 404 for
the extension script `site.js`, its MIME refusal, and "Extension script
did not load". `.dev.vars` sets an extension hook that has no file
locally.

## Reset between runs

The room keeps its own copy of each page, so reseeding the database alone
leaves the old text. In this order:

1. In Ann's window, still on the site, run
   `localStorage.clear(); indexedDB.deleteDatabase('live-pages')`, then
   send it to `about:blank`. Close Bo's window. Live pages are kept in
   IndexedDB too, so a kept copy shows the last run's text until the room
   syncs, and an open tab pushes its text back when it reconnects.
2. Stop both servers (see `running-lyriclike-locally`; check 8787 and
   `<port>`). Kill only processes you started.
3. Delete `.wrangler/state/v3/do/lyricalmiracle-collab-PageRoom`.
4. Rerun the seed, start the room, wait for Ready, start the site.

## Run through

Follow the feature files in order. Each has the steps and what proves it:

1. `features/co-editing.md`, with the switch on.
2. `features/paused-pages.md`, with the switch off. `.dev.vars` sets
   `LIVE_EDITING=on`, so leaving the flag out does not turn it off. Stop
   only the site (node and workerd processes whose command line has
   `<port>`), leave the room running, and restart with
   `--binding LIVE_EDITING=off`. Check Bo's `/api/me` has
   `can_share: false` before you drive.

## Faster check without a browser

`node tools/live-smoke.mjs` runs two socket clients against both servers.
Use it after room changes. It doesn't show anything on screen. It always
talks to the site on 8788, so it only works when your site has that port.

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
| Old text after a reset | The room kept its copy, Ann's IndexedDB kept one, or an open tab pushed it back. Follow "Reset between runs" |
| Console shows `WebSocket ... failed` up to about a dozen times, then works | Cold room start, up to a minute. Normal locally. The site log shows `500 ... Network connection lost`, then `101` and the room log shows `join` |
| "Offline, changes will sync" stays up while typing still reaches the other window | After a cold start the notice stays until that person types. Trust the room's `join` lines and the typing, not the notice |
| Clicks time out on a fresh browser | The tour or the Write together card is open. Set the first-visit keys (Set up, step 5) |
| Paused notice never shows | `.dev.vars` turned live editing back on. Restart with `--binding LIVE_EDITING=off` |
| `bo` is undefined | Variables don't survive between run-code calls. Look it up again |
| Close codes (4001, 4004...) never arrive locally | Known: the local two-process proxy drops them. Check on the preview site |

## Hand to the user

The room on Cloudflare and iPhone Safari behave differently from local:
iOS keeps a dead socket looking open after the phone sleeps. For changes to
connecting, reconnecting or presence, ask the user to test on the preview
site with two accounts, one on their iPhone. Tell them to type the URL into
Safari: links opened from the Claude app use its own browser and cookies.
