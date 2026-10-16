// One copy of each dependency for the room and the tests. Both load Yjs's ES
// module build through here, so test documents and room documents come from
// the same Yjs; two copies would not mix.
export * as Y from 'yjs';
export * as awarenessProtocol from 'y-protocols/awareness';
export { default as DiffMatchPatch } from 'diff-match-patch';
