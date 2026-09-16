// Turns page models into HTML. The pages are static and carry no script of
// their own — analytics.js is the only one they load — so all
// they need from the site is the stylesheet and the fonts it points at.

export const SITE_ORIGIN = 'https://lyriclike.com';
export const RHYMES_PATH = '/rhymes/';
const STYLESHEET_PATH = '/rhymes/rhymes.css';
const ANALYTICS_PATH = '/analytics.js';
const SITE_NAME = 'LyricLike';
// The card shown when any page is shared; the homepage uses the same image.
const PREVIEW_IMAGE_URL = `${SITE_ORIGIN}/assets/lyriclike.png`;
const PREVIEW_IMAGE_WIDTH = 1200;
const PREVIEW_IMAGE_HEIGHT = 630;
const PREVIEW_IMAGE_ALT = 'LyricLike logo';
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
// Bing flags meta descriptions longer than this; Google truncates near it.
const MAX_DESCRIPTION_LENGTH = 160;
const MAX_DESCRIPTION_EXAMPLES = 3;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function rhymePagePath(word) {
  return `${RHYMES_PATH}${encodeURIComponent(word)}/`;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function quoted(word) {
  return `“${escapeHtml(word)}”`;
}

function joinWithAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function renderHead({ title, description, path }) {
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description for ${path} is ${description.length} characters: ${description}`);
  }
  const url = SITE_ORIGIN + path;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${PREVIEW_IMAGE_URL}">
<meta property="og:image:width" content="${PREVIEW_IMAGE_WIDTH}">
<meta property="og:image:height" content="${PREVIEW_IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${PREVIEW_IMAGE_ALT}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#141922">
<link rel="apple-touch-icon" href="/assets/icons/icon-180.png">
<link rel="stylesheet" href="${STYLESHEET_PATH}">
<script src="${ANALYTICS_PATH}"></script>
</head>`;
}

function renderSiteHeader() {
  return `<header class="site-header">
<a class="wordmark" href="/">${SITE_NAME}</a>
<a class="header-link" href="${RHYMES_PATH}">Rhyming dictionary</a>
</header>`;
}

function renderCallToAction() {
  return `<aside class="cta">
<p>Writing a verse? LyricLike counts syllables and labels your rhyme scheme as you type. Free, no sign-up.</p>
<a class="cta-button" href="/">Open the lyric editor</a>
</aside>`;
}

function renderFooter() {
  return `<footer class="site-footer">
<p>Pronunciations from the <a href="https://github.com/cmusphinx/cmudict">CMU Pronouncing Dictionary</a>.
<a href="${RHYMES_PATH}">All rhyme pages</a> · <a href="/">LyricLike</a></p>
</footer>`;
}

function renderDocument(head, main) {
  return `${renderHead(head)}
<body>
${renderSiteHeader()}
<main class="page">
${main}
</main>
${renderFooter()}
</body>
</html>
`;
}

// ── Rhyme page ──

function renderWordItem(word, typeKey, pageWords) {
  const label = escapeHtml(word);
  if (!pageWords.has(word)) return `<li class="rhyme-word color-${typeKey}">${label}</li>`;
  return `<li><a class="rhyme-word color-${typeKey}" href="${rhymePagePath(word)}">${label}</a></li>`;
}

function renderSyllableGroup(group, typeKey, pageWords) {
  const label = group.syllables === 1 ? '1 syllable' : `${group.syllables} syllables`;
  const items = group.words.map((word) => renderWordItem(word, typeKey, pageWords)).join('');
  return `<h3>${label}</h3>
<ul class="rhyme-list">${items}</ul>`;
}

function renderSection(section, pageWords) {
  const groups = section.groups.map((group) => renderSyllableGroup(group, section.key, pageWords));
  const note = section.total > section.shownCount
    ? `<p class="more">Showing the ${section.shownCount} closest of ${section.total.toLocaleString('en-US')}. The editor lists them all.</p>`
    : '';
  return `<section class="rhyme-section">
<h2><span class="dot dot-${section.key}"></span>${section.name} rhymes <span class="count">${section.total.toLocaleString('en-US')}</span></h2>
<p class="type-desc">${escapeHtml(section.desc)}</p>
${groups.join('\n')}
${note}
</section>`;
}

function renderSummarySentence(model) {
  const { summary, word } = model;
  const examples = joinWithAnd(summary.examples.map(escapeHtml));
  if (summary.kind === 'perfect' && summary.total === 1) {
    return `The only perfect rhyme for ${quoted(word)} is ${examples}.`;
  }
  if (summary.kind === 'perfect') return `The best perfect rhymes for ${quoted(word)} are ${examples}.`;
  const noPerfect = `${quoted(capitalize(word))} has no perfect rhymes in the CMU Pronouncing Dictionary.`;
  if (summary.kind === 'near') return `${noPerfect} The closest near rhymes are ${examples}.`;
  return `${noPerfect} Words that share its vowel or ending sound include ${examples}.`;
}

function renderSyllableFact(model) {
  const subject = quoted(capitalize(model.word));
  if (model.syllables === 1) return `${subject} has one syllable.`;
  const ordinal = ORDINALS[model.stressedSyllable - 1] || `number ${model.stressedSyllable}`;
  return `${subject} has ${model.syllables} syllables, stressed on the ${ordinal}.`;
}

function renderRelated(related) {
  const links = related.map((word) => `<li><a href="${rhymePagePath(word)}">${escapeHtml(word)}</a></li>`);
  return `<section class="related">
<h2>More words people look up rhymes for</h2>
<ul class="related-list">${links.join('')}</ul>
</section>`;
}

function buildRhymeDescription(model, exampleCount) {
  const count = model.totalRhymes.toLocaleString('en-US');
  const tail = 'Grouped by rhyme type and syllable count.';
  if (exampleCount === 0) return `${count} words that rhyme with ${model.word}. ${tail}`;
  const examples = model.summary.examples.slice(0, exampleCount).join(', ');
  const lead = model.summary.kind === 'perfect' ? 'rhymes like' : 'near rhymes like';
  return `${count} words that rhyme with ${model.word}, including ${lead} ${examples}. ${tail}`;
}

// Long example words can push past the limit, so drop examples until it fits.
function describeRhymePage(model) {
  for (let exampleCount = MAX_DESCRIPTION_EXAMPLES; exampleCount > 0; exampleCount--) {
    const description = buildRhymeDescription(model, exampleCount);
    if (description.length <= MAX_DESCRIPTION_LENGTH) return description;
  }
  return buildRhymeDescription(model, 0);
}

export function renderRhymePage(model, pageWords) {
  const head = {
    title: `Words That Rhyme With ${capitalize(model.word)} | ${SITE_NAME}`,
    description: describeRhymePage(model),
    path: rhymePagePath(model.word)
  };
  const main = `<nav class="breadcrumb"><a href="${RHYMES_PATH}">Rhyming dictionary</a> › ${escapeHtml(model.word)}</nav>
<h1>Words that rhyme with ${escapeHtml(model.word)}</h1>
<p class="answer">${renderSummarySentence(model)}</p>
<p class="fact">${renderSyllableFact(model)}</p>
${renderCallToAction()}
${model.sections.map((section) => renderSection(section, pageWords)).join('\n')}
${renderRelated(model.related)}`;
  return renderDocument(head, main);
}

// ── Hub page ──

function groupByInitial(words) {
  const groups = new Map();
  for (const word of [...words].sort()) {
    const initial = word.charAt(0);
    if (!groups.has(initial)) groups.set(initial, []);
    groups.get(initial).push(word);
  }
  return [...groups];
}

function renderInitialSection([initial, words]) {
  const links = words.map((word) => `<li><a href="${rhymePagePath(word)}">${escapeHtml(word)}</a></li>`);
  return `<section class="letter-section" id="letter-${initial}">
<h2>${initial.toUpperCase()}</h2>
<ul class="related-list">${links.join('')}</ul>
</section>`;
}

export function renderHubPage(pageWordList) {
  const groups = groupByInitial(pageWordList);
  const jumpLinks = groups.map(([initial]) => `<a href="#letter-${initial}">${initial.toUpperCase()}</a>`);
  const head = {
    title: `Rhyming Dictionary for Songwriters | ${SITE_NAME}`,
    description: `Rhymes for the ${pageWordList.length.toLocaleString('en-US')} words people look up most, from perfect rhymes to near rhymes, sorted by syllable count.`,
    path: RHYMES_PATH
  };
  const main = `<h1>Rhyming dictionary</h1>
<p class="answer">Rhymes for the words people look up most, matched by sound rather than spelling: perfect rhymes, near rhymes and slant rhymes, with syllable counts.</p>
${renderCallToAction()}
<nav class="letter-jump">${jumpLinks.join(' ')}</nav>
${groups.map(renderInitialSection).join('\n')}`;
  return renderDocument(head, main);
}

// ── Sitemap ──

export function renderSitemap(paths) {
  const entries = paths.map((path) => `  <url>\n    <loc>${SITE_ORIGIN}${path}</loc>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}
