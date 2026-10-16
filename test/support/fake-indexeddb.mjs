// fake-indexeddb lives in collab/node_modules, like every other test
// dependency, so it is loaded from there.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../collab/package.json', import.meta.url));

export const { IDBFactory } = require('fake-indexeddb');
