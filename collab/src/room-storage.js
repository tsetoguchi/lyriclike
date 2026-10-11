// The room's own SQLite storage. The snapshot is a working copy, deleted
// once everyone has left and D1 has the text; what stays for each past epoch
// is only its final Yjs snapshot (client ids and counters, no words).

// A key plus its value must stay under 2 MB, and a 500,000-character page
// with its history can pass that, so the snapshot is split across rows.
export const CHUNK_BYTES = 1_000_000;
export const KEPT_EPOCHS = 20;

const PAGE_KEY = 'page';
const ROOM_KEY = 'room';

function joinChunks(chunks) {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export class RoomStorage {
  constructor(storage) {
    this.storage = storage;
    this.createTables();
  }

  get sql() {
    return this.storage.sql;
  }

  createTables() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS snapshot_chunks (seq INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS epochs ' +
      '(epoch TEXT PRIMARY KEY, snapshot BLOB NOT NULL, saved_at INTEGER NOT NULL)');
  }

  readMeta(key) {
    const [row] = this.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray();
    return row ? JSON.parse(row.value) : null;
  }

  writeMeta(key, value) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  loadPageId() {
    return this.readMeta(PAGE_KEY);
  }

  savePageId(id) {
    this.writeMeta(PAGE_KEY, id);
  }

  loadState() {
    const meta = this.readMeta(ROOM_KEY);
    if (!meta) return { snapshot: null, meta: null };
    const chunks = this.sql.exec('SELECT data FROM snapshot_chunks ORDER BY seq').toArray()
      .map(row => new Uint8Array(row.data));
    return { snapshot: joinChunks(chunks), meta };
  }

  // Chunks go in as ArrayBuffer, the BLOB type a Durable Object binds.
  saveSnapshot(update, meta) {
    this.sql.exec('DELETE FROM snapshot_chunks');
    for (let seq = 0; seq * CHUNK_BYTES < update.length; seq += 1) {
      const chunk = update.slice(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
      this.sql.exec('INSERT INTO snapshot_chunks (seq, data) VALUES (?, ?)', seq, chunk.buffer);
    }
    this.writeMeta(ROOM_KEY, meta);
  }

  saveMeta(meta) {
    this.writeMeta(ROOM_KEY, meta);
  }

  clearWorkingCopy(epoch, epochSnapshot, now) {
    this.sql.exec('DELETE FROM snapshot_chunks');
    this.sql.exec('DELETE FROM meta WHERE key = ?', ROOM_KEY);
    this.sql.exec('INSERT OR REPLACE INTO epochs (epoch, snapshot, saved_at) VALUES (?, ?, ?)',
      epoch, epochSnapshot.slice().buffer, now);
    this.sql.exec('DELETE FROM epochs WHERE epoch NOT IN ' +
      '(SELECT epoch FROM epochs ORDER BY saved_at DESC LIMIT ?)', KEPT_EPOCHS);
  }

  loadEpochSnapshot(epoch) {
    const [row] = this.sql.exec('SELECT snapshot FROM epochs WHERE epoch = ?', epoch).toArray();
    return row ? new Uint8Array(row.snapshot) : null;
  }

  // deleteAll drops the tables as well as the rows, so they are made again.
  async deleteAll() {
    await this.storage.deleteAll();
    this.createTables();
  }
}
