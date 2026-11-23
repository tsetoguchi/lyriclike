# Phone page head

On a phone, the page title, Share and the page's buttons scroll away with
the words, so a long lyric gets the whole screen. One Invite stays pinned
in the top right corner the whole time.

## Sub-features

- `head-scroll` the title and button row live inside the lyric's
  scroller (`#page-head` is a child of `.lyrics-area`), so they scroll
  away with the words. The button row sits above the title.
- `head-invite-corner` keeps the corner Invite (`#invite-btn-panel`) on
  screen at every scroll position.
- `head-invite-single` never shows the row's own Invite (`#invite-btn`) on
  phones.

## How to get to it (user POV)

- Sign in on a phone, open a long page, scroll the words.

## Driving it with Playwright MCP

Preconditions:

- Signed in as Ann (`smoke-token-ann`, see `running-lyriclike-locally`).
  Invite only shows signed in with limits on: `window.currentUser.page_limit`
  is a number. The seeded Ann has it.
- `page.setViewportSize({ width: 393, height: 852 })`, `innerWidth` is 393.
- A long page. Fill `#lyrics` with 60 lines and fire `input`:
  ```js
  const ta = document.getElementById('lyrics');
  ta.value = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ```

- **Top.** Run `check-duplicates.js`. `ok` is true. `#invite-btn` has
  computed `display: none`; `#invite-btn-panel` shows.
- **Small scroll.** `document.querySelector('.lyrics-area').scrollTop = 30`.
  Run the check again. `ok` is true.
- **Long scroll.** Set `scrollTop = 1500`. The title and button row are
  gone, `#invite-btn-panel` is still in the corner, and the check passes.
- **Proof.** Screenshot each scroll position to
  `.playwright-mcp/phone-page-head/`, and keep each check result.

## Gotchas

- PR #345 shipped two Invites here. A rule showing every button in the row
  (`.page-meta .toggle-btn:not([hidden])`) outranked the phone hide rule.
  Screenshots looked fine; only measuring caught it.
- After a long scroll the extra Invite is off screen, so the check passes
  even with the bug. The top and the small scroll are the ones that catch it.
- The two Invites have different aria-labels ("Invite a friend" and none)
  but both say "Invite". The check groups by visible text for this reason.
