// The scripts index.html loads, in order. Classic scripts and modules both
// count; MODULE_SCRIPTS is the subset loaded with type="module".

import { readFileSync } from 'node:fs';

const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const SCRIPT_TAG = /<script(?: type="(module)")? src="([^"]+\.js)"><\/script>/g;

const TAGS = [...INDEX_HTML.matchAll(SCRIPT_TAG)]
  .map(([, type, src]) => ({ src, isModule: type === 'module' }));

export const APP_SCRIPTS = TAGS.map(tag => tag.src);
export const MODULE_SCRIPTS = TAGS.filter(tag => tag.isModule).map(tag => tag.src);
