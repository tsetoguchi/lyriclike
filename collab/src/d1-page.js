// The room's D1 queries. D1 stays the source of truth: the room reads the
// page from it, writes the text back with compare-and-set, and re-checks
// who may still be on the page.

export function readPage(db, lyricId) {
  return db.prepare('SELECT body, title, revision FROM lyrics WHERE id = ?').bind(lyricId).first();
}

// Lands only if nobody saved (revision) or renamed (title: PATCH does not
// move the revision) since the room's last write. Never a blind write.
export async function writePage(db, lyricId, { body, title, now, baseRevision, baseTitle }) {
  const row = await db.prepare(`
    UPDATE lyrics SET body = ?, title = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND revision = ? AND title = ?
    RETURNING revision
  `).bind(body, title, now, lyricId, baseRevision, baseTitle).first();
  return row ? row.revision : null;
}

async function readValidSessions(db, sessionIds, now) {
  if (!sessionIds.length) return new Set();
  const placeholders = sessionIds.map(() => '?').join(', ');
  const { results } = await db.prepare(
    `SELECT id FROM sessions WHERE expires_at > ? AND id IN (${placeholders})`
  ).bind(now, ...sessionIds).all();
  return new Set(results.map(row => row.id));
}

// The owner's email and every shared email: the same people CAN_OPEN lets in.
async function readAllowedEmails(db, lyricId) {
  const { results } = await db.prepare(`
    SELECT users.email_normalized AS email FROM lyrics JOIN users ON users.id = lyrics.user_id
    WHERE lyrics.id = ?
    UNION SELECT email_normalized AS email FROM lyric_shares WHERE lyric_id = ?
  `).bind(lyricId, lyricId).all();
  return new Set(results.map(row => row.email));
}

export async function readAccess(db, lyricId, sessionIds, now) {
  const [validSessions, allowedEmails] = await Promise.all([
    readValidSessions(db, sessionIds, now),
    readAllowedEmails(db, lyricId),
  ]);
  return { validSessions, allowedEmails };
}
