// Stands in for a SQLite-backed Durable Object's ctx.storage: sql.exec with
// cursors, and deleteAll. BLOBs come back as ArrayBuffer, as they do there.
import { DatabaseSync } from 'node:sqlite';

function toBinding(value) {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

function fromColumn(value) {
  return value instanceof Uint8Array ? value.slice().buffer : value;
}

function plainRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromColumn(value)]));
}

export function createFakeDurableStorage() {
  let db = new DatabaseSync(':memory:');
  const storage = {
    rowsWritten: 0,
    sql: {
      exec(query, ...bindings) {
        const statement = db.prepare(query);
        const args = bindings.map(toBinding);
        if (statement.columns().length) {
          const rows = statement.all(...args).map(plainRow);
          return { toArray: () => rows, one: () => rows[0] };
        }
        storage.rowsWritten += Number(statement.run(...args).changes);
        return { toArray: () => [], one: () => undefined };
      },
    },
    async deleteAll() {
      db.close();
      db = new DatabaseSync(':memory:');
    },
  };
  return storage;
}
