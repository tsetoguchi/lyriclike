# Rhyme pages feature map

One file per thing a visitor reaches on the static rhyme pages. Read this
index, then use the matching file as the recipe. Rebuild steps and common
mistakes live in `../SKILL.md`.

## Baseline

- Site running on port 8788 per `running-lyriclike-locally`.
- Pages as committed in `rhymes/` (no local rebuild unless the change is
  to the generator).
- Port 8788 taken by another session? Any free port works for these
  pages, since nothing here signs in.

## Clean start

Tests that open the editor need a browser with no saved page. On any page
of the site, clear both stores, then navigate:

```js
await page.evaluate(async () => {
  localStorage.clear(); sessionStorage.clear();
  for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name);
});
```

## Proof rules

- Check the served page in the browser, not just the file.
- Screenshots go in `.playwright-mcp/<feature>/`. Cleanup never deletes it.

## Features

- [Word page](./word-page.md): one word's rhymes, its SEO tags, and the
  link into the editor.
- [Word search](./word-search.md): the "Find rhymes" box that opens the
  editor on any typed word.
- [Missing word](./missing-word.md): a real 404 for words with no page.
- [Index and sitemap](./index-and-sitemap.md): the list of all pages and
  the sitemap.
