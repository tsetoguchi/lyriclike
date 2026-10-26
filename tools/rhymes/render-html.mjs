// Turns page models into HTML. The pages are static and carry no script of
// their own — analytics.js is the only one they load — so all
// they need from the site is the stylesheet and the fonts it points at.

export const SITE_ORIGIN = 'https://lyriclike.com';
export const RHYMES_PATH = '/rhymes/';
// The app's shared values come first; the page's own rules use them.
const TOKENS_PATH = '/tokens.css';
const STYLESHEET_PATH = '/rhymes/rhymes.css';
const ANALYTICS_PATH = '/analytics.js';
const SITE_NAME = 'LyricLike';
// The editor reads this query parameter as the word to open on (storage.js).
const EDITOR_WORD_PARAM = 'rhymes';
// The card shown when any page is shared; the homepage uses the same image.
const PREVIEW_IMAGE_URL = `${SITE_ORIGIN}/assets/lyriclike.png`;
const PREVIEW_IMAGE_WIDTH = 1200;
const PREVIEW_IMAGE_HEIGHT = 630;
const PREVIEW_IMAGE_ALT = 'LyricLike logo';
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
// Bing flags meta descriptions longer than this; Google truncates near it.
const MAX_DESCRIPTION_LENGTH = 160;
const MAX_DESCRIPTION_EXAMPLES = 4;

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

// JSON-LD sits in a <script> tag, so "<" is escaped to keep a word from
// closing it early. It is data, not code: browsers never run it.
function renderStructuredData(data) {
  const json = JSON.stringify({ '@context': 'https://schema.org', ...data }).replace(/</g, '\\u003c');
  return `\n<script type="application/ld+json">${json}</script>`;
}

function renderHead({ title, description, path, structuredData }) {
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
<link rel="apple-touch-icon" href="/assets/icons/icon-v2-180.png">
<link rel="stylesheet" href="${TOKENS_PATH}">
<link rel="stylesheet" href="${STYLESHEET_PATH}">
<script src="${ANALYTICS_PATH}"></script>${structuredData ? renderStructuredData(structuredData) : ''}
</head>`;
}

function renderSiteHeader() {
  return `<header class="site-header"><div class="site-header-inner">
<a class="wordmark" href="/">Lyric<span>Like</span></a>
<a class="header-link" href="${RHYMES_PATH}">Rhyming dictionary</a>
</div></header>`;
}

function renderCallToAction() {
  return `<aside class="cta">
<p>Writing a verse? LyricLike counts syllables and labels your rhyme scheme as you type. Free, no sign-up.</p>
<a class="cta-button" href="/">Open the lyric editor</a>
</aside>`;
}

// Opens the editor with this word's rhymes already beside a blank page, so
// the reader carries on from where they are rather than starting over.
export function editorLinkFor(word) {
  return `/?${EDITOR_WORD_PARAM}=${encodeURIComponent(word)}`;
}

function renderWordCallToAction(word) {
  return `<aside class="cta">
<p>Write your lyrics next to every rhyme for ${quoted(word)}. LyricLike counts syllables and labels your rhyme scheme as you type. Free, no sign-up.</p>
<a class="cta-button" href="${editorLinkFor(word)}">Write with these rhymes</a>
</aside>`;
}

function renderFooter({ withMeanings }) {
  const meanings = withMeanings
    ? '\nMeanings from <a href="https://wordnet.princeton.edu/">WordNet</a>, © Princeton University.'
    : '';
  return `<footer class="site-footer">
<p>Pronunciations from the <a href="https://github.com/cmusphinx/cmudict">CMU Pronouncing Dictionary</a>.${meanings}
<a href="${RHYMES_PATH}">All rhyme pages</a> · <a href="/">LyricLike</a></p>
</footer>`;
}

function renderDocument(head, main, { withMeanings = false } = {}) {
  return `${renderHead(head)}
<body>
${renderSiteHeader()}
<main class="page">
${main}
</main>
${renderFooter({ withMeanings })}
</body>
</html>
`;
}

// ── Rhyme page ──

function renderWordItem({ word }, typeKey, pageWords) {
  const label = escapeHtml(word);
  const classes = `rhyme-word color-${typeKey}`;
  if (!pageWords.has(word)) return `<li class="${classes}">${label}</li>`;
  return `<li><a class="${classes}" href="${rhymePagePath(word)}">${label}</a></li>`;
}

function renderSyllableGroup(group, typeKey, pageWords) {
  const label = group.syllables === 1 ? '1 syllable' : `${group.syllables} syllables`;
  const items = group.words.map((entry) => renderWordItem(entry, typeKey, pageWords)).join('');
  return `<h3>${label}</h3>
<ul class="rhyme-list">${items}</ul>`;
}

function renderSection(section, pageWords, word) {
  const groups = section.groups.map((group) => renderSyllableGroup(group, section.key, pageWords));
  const note = section.total > section.shownCount
    ? `<p class="more">Showing ${section.shownCount} of ${section.total.toLocaleString('en-US')}. <a href="${editorLinkFor(word)}">See them all in the editor</a>.</p>`
    : '';
  return `<section class="rhyme-section">
<h2><span class="dot dot-${section.key}"></span>${section.name} rhymes<span class="count">${section.total.toLocaleString('en-US')}</span></h2>
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

// The pronunciation is the word's own, so this line differs even between
// two pages whose rhyme lists are the same.
function renderSyllableFact(model) {
  const subject = `${quoted(capitalize(model.word))} <span class="ipa">/${model.ipa}/</span>`;
  if (model.syllables === 1) return `${subject} has one syllable.`;
  const ordinal = ORDINALS[model.stressedSyllable - 1] || `number ${model.stressedSyllable}`;
  return `${subject} has ${model.syllables} syllables, stressed on the ${ordinal}.`;
}

function renderSense({ pos, definition, example }) {
  const shown = example ? ` <q class="example">${escapeHtml(example)}</q>` : '';
  return `<li><span class="pos">${pos}</span> ${escapeHtml(definition)}.${shown}</li>`;
}

function renderMeaning(model) {
  const { meaning, word } = model;
  if (!meaning) return '';
  const form = meaning.base
    ? `\n<p class="meaning-base">${quoted(capitalize(word))} is a form of ${quoted(meaning.base)}.</p>`
    : '';
  return `<section class="meaning">
<h2>What ${escapeHtml(word)} means</h2>${form}
<ul class="sense-list">${meaning.senses.map(renderSense).join('')}</ul>
</section>`;
}

function renderRelated(related) {
  const links = related.map((word) => `<li><a href="${rhymePagePath(word)}">${escapeHtml(word)}</a></li>`);
  return `<section class="related">
<h2>More words people look up rhymes for</h2>
<ul class="related-list">${links.join('')}</ul>
</section>`;
}

// Counts the words the page lists, not every match: "7,005 words" reads as a
// raw dump in a search result, and most of those are loose sound matches.
function countShownRhymes(model) {
  return model.sections.reduce((sum, section) => sum + section.shownCount, 0);
}

// Most searchers type "what rhymes with..." or "words that rhyme with...",
// and a result that shows real rhymes up front gets the click.
function describeExamples(summary, exampleCount) {
  const examples = joinWithAnd(summary.examples.slice(0, exampleCount));
  if (summary.kind === 'perfect') return ` ${capitalize(examples)}.`;
  const label = summary.kind === 'near' ? 'Closest' : 'Nearest sounds';
  return ` No perfect rhymes. ${label}: ${examples}.`;
}

function buildRhymeDescription(model, exampleCount) {
  const count = countShownRhymes(model).toLocaleString('en-US');
  const examples = exampleCount === 0 ? '' : describeExamples(model.summary, exampleCount);
  return `What rhymes with ${model.word}?${examples} See all ${count} rhymes for songs and poems, sorted by syllable count.`;
}

// Long example words can push past the limit, so drop examples until it fits.
export function describeRhymePage(model) {
  for (let exampleCount = MAX_DESCRIPTION_EXAMPLES; exampleCount > 0; exampleCount--) {
    const description = buildRhymeDescription(model, exampleCount);
    if (description.length <= MAX_DESCRIPTION_LENGTH) return description;
  }
  return buildRhymeDescription(model, 0);
}

// Matches the visible breadcrumb, so search results can show the same trail.
function rhymeBreadcrumb(word) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Rhyming dictionary', item: SITE_ORIGIN + RHYMES_PATH },
      { '@type': 'ListItem', position: 2, name: word, item: SITE_ORIGIN + rhymePagePath(word) }
    ]
  };
}

export function renderRhymePage(model, pageWords) {
  const head = {
    title: `Words That Rhyme With ${capitalize(model.word)} | ${SITE_NAME}`,
    description: describeRhymePage(model),
    path: rhymePagePath(model.word),
    structuredData: rhymeBreadcrumb(model.word)
  };
  const main = `<nav class="breadcrumb"><a href="${RHYMES_PATH}">Rhyming dictionary</a> › ${escapeHtml(model.word)}</nav>
<h1>Words that rhyme with ${escapeHtml(model.word)}</h1>
<p class="answer">${renderSummarySentence(model)}</p>
<p class="fact">${renderSyllableFact(model)}</p>
${renderMeaning(model)}
${renderWordCallToAction(model.word)}
${model.sections.map((section) => renderSection(section, pageWords, model.word)).join('\n')}
${renderWordCallToAction(model.word)}
${renderRelated(model.related)}`;
  return renderDocument(head, main, { withMeanings: Boolean(model.meaning) });
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
    description: `Rhymes for ${pageWordList.length.toLocaleString('en-US')} common words and the ones people look up most, from perfect rhymes to near rhymes, sorted by syllable count.`,
    path: RHYMES_PATH
  };
  const main = `<h1>Rhyming dictionary</h1>
<p class="answer">Rhymes for common words and the ones people look up most, matched by sound rather than spelling: perfect rhymes, near rhymes and slant rhymes, with syllable counts.</p>
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
