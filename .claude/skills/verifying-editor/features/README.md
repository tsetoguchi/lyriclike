# Editor feature map

One file per thing a writer does in the editor. Read this index, then use
the matching file as the recipe. Setup, the `pickWord` helper and common
mistakes live in `../SKILL.md`.

## Baseline

- Site running on `http://localhost:8788` per `running-lyriclike-locally`.
- Signed out, `localStorage` and `sessionStorage` cleared, `rhymeSort`
  unset. The toggles live in `sessionStorage`.
- Desktop 1440×900 unless the file says phone.

## Proof rules

- Capture the action and the state after it, not only the final screen.
- Screenshots go in `.playwright-mcp/<feature>/`. Cleanup never deletes it.
- A journey that can't run says why. Never swap in an easier path.

## Features

- [Sample verse](./sample-verse.md): what a first visit shows.
- [Counts and scheme](./counts-and-scheme.md): syllable gutter, rhyme
  scheme letters, internal rhyme marks.
- [Pick a word](./pick-a-word.md): picking, rhyme chips, sort menu,
  a rhyme's meaning.
- [Draft saving](./draft-saving.md): signed-out text survives a reload.
- [Phone layout](./phone-layout.md): Lyrics and Rhymes tabs at 393px.
- [Phone page head](./phone-page-head.md): title and buttons scroll away,
  one Invite stays in the corner.
- [Phone gestures](./phone-gestures.md): swipes to the sidebar and between
  tabs, hold Highlights to pick an overlay.
- [Bar switches](./bar-switches.md): hollow and filled icons for off and
  on in the bottom bar.
- [Edge fades](./edge-fades.md): top and bottom of the lyrics fade while
  there is more past them.
