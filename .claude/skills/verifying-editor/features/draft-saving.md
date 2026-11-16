# Draft saving

A signed-out writer's text is kept in the browser, so it's still there
after a reload.

## Sub-features

- `draft-store` writes the text to `localStorage.swag_draft`.
- `draft-restore` puts it back on the next load.

## How to get to it (user POV)

- Type while signed out, then reload or come back later.

## Driving it with Playwright MCP

Preconditions:

- Signed out. Some text typed (for example the lines from
  `counts-and-scheme.md`).

- **Stored.** `localStorage.swag_draft` holds the typed text.
- **Reload.** `page.goto('http://localhost:8788/')` (not `page.reload()`).
  `#lyrics` still holds the text and the sample verse does not come back.
- **Proof.** Screenshot after reload to
  `.playwright-mcp/draft-saving/after-reload.png`.

## Gotchas

- `page.reload()` inside `browser_run_code_unsafe` can land on
  `about:blank`. Use `page.goto`.
