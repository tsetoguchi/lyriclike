// Yjs and diff-match-patch live in collab/node_modules, where the room
// Worker gets them, so the tests load the very same copies.
import { createRequire } from 'node:module';

const requireFromCollab = createRequire(new URL('../../collab/package.json', import.meta.url));

export const Y = requireFromCollab('yjs');
export const DiffMatchPatch = requireFromCollab('diff-match-patch');

export function newDmp() {
  return new DiffMatchPatch();
}
