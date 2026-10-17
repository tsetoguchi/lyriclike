---
name: verifying-rhyme-pages
description: Use when a change touches LyricLike's static rhyme pages or SEO - anything under tools/rhymes/, /rhymes/, sitemap.xml, 404.html, page titles, meta descriptions, canonical links, structured data, or rhyme-core.js output shown on the pages - and needs checking before a PR
---

# Verifying rhyme pages

## Overview

`/rhymes/<word>/` holds 5,000 static pages built by
`tools/rhymes/build-pages.mjs` and committed, since the site has no build
step. Check the served pages in the browser; check the files with git.

**REQUIRED:** follow `running-lyriclike-locally` to start the site.

## Run through

1. **A word page.** `page.goto('/rhymes/night/')` answers 200 with:
   - title "Words That Rhyme With Night | LyricLike"
   - a meta description under 160 characters, starting "3,787 words
     that rhyme with night"
   - canonical `https://lyriclike.com/rhymes/night/`
   - one JSON-LD block of `@type` BreadcrumbList that parses
   - h1 "Words that rhyme with night", then the pronunciation `/naɪt/`,
     "What night means", and groups Perfect (72), Family, Additive,
     Subtractive, Assonance, Consonance, each split by syllable count
   - an "Open the lyric editor" link to `/`
2. **Missing word.** `/rhymes/zzqqx/` answers a real 404 with title "Page
   not found | LyricLike", not the app.
3. **Index.** `/rhymes/` answers 200, "Rhyming Dictionary for Songwriters",
   linking every page.
4. **Sitemap.** `/sitemap.xml` answers 200 with one `<loc>` per page plus
   the home page (5,003 today).
5. **Phone.** At 393px, `document.documentElement.scrollWidth` is at most
   `innerWidth`: no sideways scroll.

Screenshot the word page at both widths into `.playwright-mcp/`.

## Changed the generator?

Rebuild and read the diff. A change meant for one part of the page should
change only that part across files.

```bash
node tools/rhymes/build-pages.mjs
git diff --stat rhymes sitemap.xml
```

The rebuild writes LF line endings and the checkout has CRLF, so `git
status` marks all 5,000 pages modified even when nothing changed. Trust
`git diff --stat`: empty means identical. To clear the noise, run
`git checkout -- rhymes sitemap.xml`, which also restores everything if a
rebuild ever stops halfway.

A new folder under `rhymes/` after a rebuild is a new page. Check
`git status --short --ignored rhymes`: an ignored page never deploys.

## Common mistakes

| Symptom | Cause |
|---|---|
| Thousands of `M rhymes/...` but an empty diff | Line endings only. See above |
| A sitemap page is 404 on the live site | A `.gitignore` rule hides its folder. `test/sitemap-pages.test.mjs` catches this |
| Unknown word shows the app | `404.html` missing or moved |
| Word in the editor but no page | It's in `tools/rhymes/page-excluded-words.json`, or a name, rare or crude word. On purpose |
| A page folder can't be pulled on Windows | Reserved names (`con`, `nul`, `aux`...) need special handling |

## Hand to the user

Search engines only see the real site. After a title, description or
structured data change deploys, ask the user to run the URL through Google
Search Console's URL inspection.
