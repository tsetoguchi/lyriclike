// Builds vendor/live-deps-*.js: the browser's copy of Yjs, diff-match-patch
// and the room's wire format, as one script that sets window.LiveDeps. The
// name carries the Yjs and protocol versions, so it can be cached forever.
//
//   npm ci --prefix collab && node tools/build-live-deps.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_VERSION } from '../collab/src/protocol.js';

const COLLAB = new URL('../collab/', import.meta.url);
const requireFromCollab = createRequire(new URL('package.json', COLLAB));
const esbuild = requireFromCollab('esbuild');

export function liveDepsFileName() {
  const { dependencies } = JSON.parse(readFileSync(new URL('package.json', COLLAB), 'utf8'));
  return `live-deps-yjs${dependencies.yjs}-p${PROTOCOL_VERSION}.js`;
}

export async function buildLiveDeps() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('src/browser-deps.js', COLLAB))],
    bundle: true,
    format: 'iife',
    globalName: 'LiveDeps',
    minify: true,
    target: 'es2020',
    legalComments: 'eof',
    write: false,
  });
  return result.outputFiles[0].text;
}

const isRunDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isRunDirectly) {
  const file = new URL(`../vendor/${liveDepsFileName()}`, import.meta.url);
  writeFileSync(file, await buildLiveDeps());
  console.log(`wrote ${fileURLToPath(file)}`);
}
