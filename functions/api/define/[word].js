// Definition lookup proxied through our own origin.
//
// The client used to call api.dictionaryapi.dev directly. That host regularly
// answers with a Cloudflare 522 page, which carries no CORS headers, so the
// browser blocked the response and every lookup fell through to the "no
// definition found" branch. Proxying removes the CORS dependency, lets us fall
// back to a second source, and caches results at the edge so a flaky upstream
// stops being visible to users.

const DICTIONARY_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const WIKTIONARY_API_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
const USER_AGENT = 'LyricLike (https://lyriclike.com)';

// Kept short: when the primary source is timing out, this is the delay a
// user waits before the fallback source is tried.
const UPSTREAM_TIMEOUT_MS = 3000;
const SUCCESS_CACHE_SECONDS = 60 * 60 * 24 * 7;
const NOT_FOUND_CACHE_SECONDS = 60 * 60 * 24;

const MAX_WORD_LENGTH = 64;
const WORD_PATTERN = /^[a-z][a-z'-]*$/;
const MAX_MEANINGS = 5;
const MAX_DEFINITIONS_PER_MEANING = 5;

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;

const NOT_FOUND = 'not_found';
const UNAVAILABLE = 'unavailable';

export async function onRequestGet({ request, params, waitUntil }) {
  const word = normalizeWord(params.word);
  if (!word) {
    return jsonResponse({ error: 'invalid word' }, HTTP_BAD_REQUEST, 0);
  }

  const cache = caches.default;
  const cacheKey = buildCacheKey(request, word);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await buildDefinitionResponse(word);
  if (isCacheable(response)) {
    waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

async function buildDefinitionResponse(word) {
  const result = await lookupDefinition(word);
  if (result.entry) {
    return jsonResponse(result.entry, 200, SUCCESS_CACHE_SECONDS);
  }
  if (result.status === NOT_FOUND) {
    return jsonResponse({ error: NOT_FOUND }, HTTP_NOT_FOUND, NOT_FOUND_CACHE_SECONDS);
  }
  return jsonResponse({ error: UNAVAILABLE }, HTTP_UNAVAILABLE, 0);
}

// Only a source that actually answered can prove a word has no entry, so an
// outage on every source reports "unavailable" rather than a false miss.
async function lookupDefinition(word) {
  const sources = [
    { url: DICTIONARY_API_URL, parse: parseDictionaryApi },
    { url: WIKTIONARY_API_URL, parse: parseWiktionary },
  ];

  let hasDefinitiveMiss = false;
  for (const source of sources) {
    const result = await fetchFromSource(source, word);
    if (result.entry) return result;
    if (result.status === NOT_FOUND) hasDefinitiveMiss = true;
  }
  return { status: hasDefinitiveMiss ? NOT_FOUND : UNAVAILABLE };
}

async function fetchFromSource({ url, parse }, word) {
  try {
    const resp = await fetch(url + encodeURIComponent(word), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (resp.status === HTTP_NOT_FOUND) return { status: NOT_FOUND };
    if (!resp.ok) return { status: UNAVAILABLE };

    const entry = parse(await resp.json(), word);
    return entry ? { entry } : { status: NOT_FOUND };
  } catch {
    return { status: UNAVAILABLE };
  }
}

function parseDictionaryApi(data, word) {
  const entry = Array.isArray(data) ? data[0] : null;
  if (!entry) return null;

  const meanings = asArray(entry.meanings).map(meaning => ({
    partOfSpeech: toPlainText(meaning.partOfSpeech).toLowerCase(),
    definitions: asArray(meaning.definitions).map(def => ({
      definition: toPlainText(def.definition),
      example: toPlainText(def.example),
    })),
  }));

  return buildEntry(toPlainText(entry.word) || word, pickPhonetic(entry), meanings);
}

function parseWiktionary(data, word) {
  const sections = data ? data.en : null;
  if (!Array.isArray(sections)) return null;

  const meanings = sections.map(section => ({
    partOfSpeech: toPlainText(section.partOfSpeech).toLowerCase(),
    definitions: asArray(section.definitions).map(def => ({
      definition: toPlainText(def.definition),
      example: toPlainText(asArray(def.examples)[0]),
    })),
  }));

  return buildEntry(word, '', meanings);
}

function pickPhonetic(entry) {
  if (entry.phonetic) return toPlainText(entry.phonetic);
  const spelled = asArray(entry.phonetics).find(p => p && p.text);
  return spelled ? toPlainText(spelled.text) : '';
}

function buildEntry(word, phonetic, meanings) {
  const populated = meanings
    .map(meaning => ({
      partOfSpeech: meaning.partOfSpeech,
      definitions: meaning.definitions
        .filter(def => def.definition)
        .slice(0, MAX_DEFINITIONS_PER_MEANING),
    }))
    .filter(meaning => meaning.definitions.length > 0)
    .slice(0, MAX_MEANINGS);

  if (populated.length === 0) return null;
  return { word, phonetic, meanings: populated };
}

const HTML_TAG_PATTERN = /<[^>]*>/g;
const NAMED_ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|nbsp);/g;
const NUMERIC_ENTITY_PATTERN = /&#(\d+);/g;
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

// Wiktionary returns definitions as HTML fragments, and the client renders
// definitions with innerHTML, so markup is stripped here rather than trusted.
function toPlainText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(HTML_TAG_PATTERN, '')
    .replace(NAMED_ENTITY_PATTERN, (_, name) => NAMED_ENTITIES[name])
    .replace(NUMERIC_ENTITY_PATTERN, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWord(rawWord) {
  const word = String(rawWord || '').trim().toLowerCase();
  if (!word || word.length > MAX_WORD_LENGTH) return null;
  return WORD_PATTERN.test(word) ? word : null;
}

function buildCacheKey(request, word) {
  return new Request(new URL('/api/define/' + word, request.url).toString());
}

function isCacheable(response) {
  return response.status === 200 || response.status === HTTP_NOT_FOUND;
}

function jsonResponse(body, status, cacheSeconds) {
  const cacheControl = cacheSeconds > 0
    ? 'public, max-age=' + cacheSeconds
    : 'no-store';

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
