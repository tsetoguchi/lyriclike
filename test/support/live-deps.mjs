// Yjs and diff-match-patch come through collab/src/deps.js, the very copies
// the room Worker uses, so test documents and room documents share one Yjs.
import { DiffMatchPatch, Y, awarenessProtocol } from '../../collab/src/deps.js';

export { DiffMatchPatch, Y, awarenessProtocol };

export function newDmp() {
  return new DiffMatchPatch();
}
