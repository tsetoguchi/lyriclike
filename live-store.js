// The device's local copy of each open live page (plans/live-co-editing.md
// §5.2): its working doc, confirmed doc and unsaved updates, kept in
// IndexedDB so they outlast a reload or a closed browser. A Yjs doc is
// binary, and a long page's history would crowd localStorage's ~5 MB,
// which the draft already shares.
(function exposeLiveStore(root) {
  'use strict';

  const DB_NAME = 'live-pages';
  const DB_VERSION = 1;
  const STORE_NAME = 'pages';

  function openDatabase(factory) {
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        // A newer app, in another tab, is upgrading the database: step aside
        // rather than block it. The next call opens again.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Resolves once the transaction has committed, so a save that resolved
  // is on disk. A failed request aborts its transaction.
  function runTransaction(db, mode, work) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = work(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
    });
  }

  class LiveStore {
    constructor(factory) {
      this.factory = factory;
      this.opening = null;
    }

    database() {
      if (!this.opening) {
        this.opening = openDatabase(this.factory).catch(err => {
          this.opening = null;
          throw err;
        });
      }
      return this.opening;
    }

    // Every call waits on the same opening, so transactions start in the
    // order the calls were made. A failure is tried once more on a new
    // connection: Safari closes them in the background (InvalidStateError)
    // or loses its database server (UnknownError), and a new one works.
    async run(mode, work) {
      try {
        return await runTransaction(await this.database(), mode, work);
      } catch {
        this.opening = null;
        return runTransaction(await this.database(), mode, work);
      }
    }

    async save(record) {
      await this.run('readwrite', store => store.put(record));
    }

    async load(id) {
      const record = await this.run('readonly', store => store.get(id));
      return record || null;
    }

    async remove(id) {
      await this.run('readwrite', store => store.delete(id));
    }

    async clear() {
      await this.run('readwrite', store => store.clear());
    }
  }

  // Without IndexedDB (storage blocked, some private modes) nothing is
  // kept, and a reload rebases what is on screen instead.
  const NO_STORE = Object.freeze({
    save: async () => {},
    load: async () => null,
    remove: async () => {},
    clear: async () => {},
  });

  function createLiveStore(scope) {
    try {
      return scope.indexedDB ? new LiveStore(scope.indexedDB) : NO_STORE;
    } catch {
      // Reading indexedDB throws where the browser blocks storage.
      return NO_STORE;
    }
  }

  const LiveStoreApi = { LiveStore, NO_STORE, createLiveStore };

  if (typeof module === 'object' && module.exports) {
    module.exports = LiveStoreApi;
  } else {
    root.LiveStore = LiveStoreApi;
  }
})(globalThis);
