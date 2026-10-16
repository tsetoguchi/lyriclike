// The workflow that deploys the room (collab/) must run on every change the
// room is built from, including files outside collab/ that it imports, or a
// change would reach the site but not the room.
//
//   node --test "test/*.test.mjs"

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const WORKFLOW = readFileSync(new URL('../.github/workflows/collab-deploy.yml', import.meta.url), 'utf8');
const ROOM_SOURCE = new URL('../collab/src/', import.meta.url);

// Root files the room imports, as paths from the repo root.
function rootImports() {
  const found = new Set();
  for (const file of readdirSync(ROOM_SOURCE)) {
    const source = readFileSync(new URL(file, ROOM_SOURCE), 'utf8');
    for (const match of source.matchAll(/from '\.\.\/\.\.\/([^']+)'/g)) found.add(match[1]);
  }
  return [...found];
}

describe('the room deploy workflow', () => {
  it('watches collab/ and itself', () => {
    assert.match(WORKFLOW, /- 'collab\/\*\*'/);
    assert.match(WORKFLOW, /- '\.github\/workflows\/collab-deploy\.yml'/);
  });

  it('watches every file outside collab/ that the room imports', () => {
    const imports = rootImports();
    assert.ok(imports.includes('live-core.js'));
    for (const file of imports) assert.ok(WORKFLOW.includes(`- '${file}'`), file);
  });

  it('deploys only after the tests pass, with the pinned wrangler', () => {
    assert.match(WORKFLOW, /needs: test/);
    assert.match(WORKFLOW, /wrangler@4\.131\.2 deploy/);
    assert.match(WORKFLOW, /secrets\.CLOUDFLARE_WORKERS_TOKEN/);
  });

  it('sends main to production and other branches to the preview room', () => {
    assert.match(WORKFLOW, /refs\/heads\/main/);
    assert.match(WORKFLOW, /deploy --env preview/);
  });
});
