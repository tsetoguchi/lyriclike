# Live editing feature map

One file per thing two people do on a shared page. Read this index, then
use the matching file as the recipe. Two-server setup, Bo's window, the
reset steps and common mistakes live in `../SKILL.md`.

## Baseline

- Room on 8787 and the site on a free port, started in that order, per
  `../SKILL.md`.
- First-visit keys set in both windows (`../SKILL.md`, Set up), so the
  tour and the Write together card don't block clicks.
- `tools/live-smoke-seed.sql` loaded: Ann owns `smoke-page` and
  `smoke-solo`; `smoke-page` is shared with Bo.
- Ann in the main window (`smoke-token-ann`), Bo in a second context
  (`smoke-token-bo`).

## Proof rules

- Screenshot both windows for each step.
- Check the database with `GET /api/lyrics/smoke-page` as a second view.
- Screenshots go in `.playwright-mcp/<feature>/`. Cleanup never deletes it.

## Features

- [Co-editing](./co-editing.md): open a shared page, see each other,
  type and see it live, saved later.
- [Paused pages](./paused-pages.md): with the switch off, shared pages are
  read-only.
