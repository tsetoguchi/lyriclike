---
name: running-lyriclike-locally
description: Use when LyricLike needs to run on this machine to check a change in a real browser - starting or stopping the local site, signing in without Google, or driving it with the Playwright browser tools
---

# Running LyricLike locally

## Overview

The site runs under `wrangler pages dev` on port 8788 with a local D1
database. The Playwright MCP browser drives it. Every `verifying-*` guide
starts here.

## Start

Run these with the sandbox off. The global `wrangler` crashes on this
machine (`std::terminate`), so always use the pinned `npx` version.

1. Check nothing already holds the port. Old servers serve stale code:
   ```powershell
   try { Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction Stop } catch { 'port free' }
   ```
   If something is there and you did not start it, stop and ask.
2. Bring the local database up to date:
   ```bash
   npx --yes wrangler@4.131.2 d1 migrations apply lyricalmiracle_db --local
   ```
3. Start the site in the background (`run_in_background`):
   ```bash
   npx --yes wrangler@4.131.2 pages dev . --port 8788
   ```
   Port 8788 matters: `.dev.vars` points the Google sign-in back there.
4. Healthy means `/` answers 200 and `/api/me` answers 401.

## Sign in without Google

Seed two test users, then set their cookie in the browser.

```bash
npx --yes wrangler@4.131.2 d1 execute lyricalmiracle_db --local --file tools/live-smoke-seed.sql
```

This makes Ann, who owns pages `smoke-page` and `smoke-solo`, and Bo, who
`smoke-page` is shared with. Sign in as Ann with Playwright:

```js
await page.context().addCookies([{ name: 'sid', value: 'smoke-token-ann',
  domain: 'localhost', path: '/' }]);
await page.goto('http://localhost:8788/');
```

Bo's token is `smoke-token-bo`. Rerun the seed to reset both. The seed is
local-only: never pass `--remote`.

Email and password sign-up need extra bindings. See `verifying-accounts`.

## Driving the browser

| Need | Do |
|---|---|
| Fresh first visit | `page.evaluate(() => localStorage.clear())`, then `page.goto(...)` |
| Reload | `page.goto(url)`. `page.reload()` inside `browser_run_code_unsafe` can land on `about:blank` |
| Wait | `page.waitForTimeout(ms)`. That sandbox has no `setTimeout` |
| Desktop | `browser_resize` 1440×900 |
| Phone | `page.setViewportSize({ width: 393, height: 852 })` |
| Screenshots | Save under `.playwright-mcp/` (gitignored). Other folders are refused |

- Return `innerWidth` from every measuring script. It sometimes reports 393
  after a 1440 resize. Trust only numbers taken at the width you meant.
- The browser reports no hover and no fine pointer. Hover features never fire
  from mouse moves. Call the page's hover code directly, and check the media
  query gate on its own.
- One console error is normal on every load: `401` for `/api/me` when
  signed out. Anything else is worth a look.

## Check for doubled buttons

Screenshots miss a button that shows twice when the two copies sit on top
of each other or side by side in a crowded row. `check-duplicates.js`
measures instead: it fails when two buttons or links with the same visible
text are on screen at once.

Playwright only reads files under `C:\Users\tao\Dropbox\Apps\lyriclike`.
From a worktree, copy it into `.playwright-mcp/` first:

```bash
cp .claude/skills/running-lyriclike-locally/check-duplicates.js \
  C:/Users/tao/Dropbox/Apps/lyriclike/.playwright-mcp/
```

Then call `browser_run_code_unsafe` with
`filename: ".playwright-mcp/check-duplicates.js"`. It returns `ok`, the
width, and any `duplicates` with each copy's id and position.

Run it for every change to layout, CSS or which buttons show:

- at 1440 and 393 wide
- signed in and signed out (some buttons, like Invite, only show signed in)
- on a long page, at the top, after a small scroll (30px) and after a
  long one: `document.querySelector('.lyrics-area').scrollTop = <px>`

Rules:

- When a change hides one copy of a button and shows another, prove the
  hidden one is hidden: its `getComputedStyle(el).display` is `none`.
  "The new one shows" is not proof.
- Wait about a second after `goto` or a resize. A sidebar still sliding
  shut shows its items next to the page's and gives a false alarm.
- Close drawers and menus first. With one open, an item in it and the
  same item behind it can both count.

## Stop

Stopping the background task leaves wrangler's `node.exe` and `workerd.exe`
running, and they keep the port. Kill only the ones you started:

```powershell
$since = (Get-Date).AddHours(-2)   # set to when you started the server
Get-CimInstance Win32_Process |
  Where-Object { ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'wrangler') -or $_.Name -eq 'workerd.exe' } |
  Where-Object { $_.CreationDate -gt $since } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
try { Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction Stop } catch { 'port free' }
```

The last line should print `port free`. If the live-editing room ran, check
port 8787 the same way. Leave older processes alone.

## What local testing can't show

- **iPhone behaviour.** Caret, selection, keyboard and scroll bugs on iOS
  Safari don't reproduce in desktop Chrome. Ask the user to check on their
  iPhone, and say exactly what to tap.
- **Turnstile and real email.** They only work on the real site.

Say which of these a change touches when you report.
