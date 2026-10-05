// On-screen censoring. Only the displayed text changes; timing and rhyme detection
// still use the real word. Pure, so node --test can load it.

function matchCase(replacement: string, original: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// `censored` maps a lower-case word to how it should appear, e.g. bitches -> b*tches.
export function censorDisplay(raw: string, censored: Record<string, string>): string {
  const replacement = censored[raw.toLowerCase()];
  return replacement === undefined ? raw : matchCase(replacement, raw);
}
