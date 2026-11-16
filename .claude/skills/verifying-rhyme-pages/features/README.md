# Rhyme pages feature map

One file per thing a visitor reaches on the static rhyme pages. Read this
index, then use the matching file as the recipe. Rebuild steps and common
mistakes live in `../SKILL.md`.

## Baseline

- Site running on port 8788 per `running-lyriclike-locally`.
- Pages as committed in `rhymes/` (no local rebuild unless the change is
  to the generator).

## Proof rules

- Check the served page in the browser, not just the file.
- Screenshots go in `.playwright-mcp/<feature>/`. Cleanup never deletes it.

## Features

- [Word page](./word-page.md): one word's rhymes, its SEO tags, and the
  link into the editor.
- [Missing word](./missing-word.md): a real 404 for words with no page.
- [Index and sitemap](./index-and-sitemap.md): the list of all pages and
  the sitemap.
