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
- Two console errors are normal on every load: `401` for `/api/me` when
  signed out, and `404` for `/favicon.ico`. Anything else is worth a look.

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
