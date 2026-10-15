// An in-memory stand-in for the IndexedDB copy store (live-store.js), with
// the same async calls. Records are cloned, as IndexedDB clones them.
export function createFakeLiveStore() {
  const records = new Map();
  const store = {
    writes: 0,
    isBroken: false,
    async save(record) {
      failIfBroken();
      store.writes += 1;
      records.set(record.id, structuredClone(record));
    },
    async load(id) {
      failIfBroken();
      return records.has(id) ? structuredClone(records.get(id)) : null;
    },
    async remove(id) {
      failIfBroken();
      records.delete(id);
    },
    async clear() {
      failIfBroken();
      records.clear();
    },
  };
  function failIfBroken() {
    if (store.isBroken) throw new Error('storage unavailable');
  }
  return store;
}
