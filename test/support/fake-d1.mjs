// Stands in for the D1 binding with an in-memory SQLite database built from
// the real migrations, so API handlers run their actual SQL under test.

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

// node:sqlite hands back null-prototype rows; D1 hands back plain objects.
function toPlainRow(row) {
  return row ? { ...row } : null;
}

class FakeStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new FakeStatement(this.db, this.sql, params);
  }

  runNow() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: info.changes } };
  }

  async run() {
    return this.runNow();
  }

  async first() {
    return toPlainRow(this.db.prepare(this.sql).get(...this.params));
  }

  async all() {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { success: true, results: rows.map(toPlainRow) };
  }
}

class FakeD1 {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new FakeStatement(this.db, sql);
  }

  // D1 runs a batch as one transaction: all of it lands or none of it does.
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.runNow());
      this.db.exec('COMMIT');
      return results;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
}

export function createFakeD1() {
  const db = new DatabaseSync(':memory:');
  // D1 enforces foreign keys; SQLite leaves them off unless asked.
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of listMigrations()) {
    db.exec(readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8'));
  }
  return new FakeD1(db);
}
