import type { DatabaseSync } from 'node:sqlite';
import { withoutPhone } from './privacy.ts';

export const SCHEMA_VERSION = 1;
const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;

export function migrateDatabase(db: DatabaseSync) {
  if (version(db) > SCHEMA_VERSION) throw new Error('База создана более новой версией SFMap. Обновите приложение.');
  db.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; PRAGMA journal_mode=WAL');
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = version(db);
    if (current > SCHEMA_VERSION) throw new Error('База создана более новой версией SFMap.');
    if (current < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, participant_id TEXT);
        CREATE TABLE IF NOT EXISTS avatars (username TEXT PRIMARY KEY, checked INTEGER NOT NULL, filename TEXT);
        CREATE TABLE IF NOT EXISTS participants (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), updated_at TEXT NOT NULL, revision TEXT NOT NULL);
      `);
      const columns = (db.prepare('PRAGMA table_info(avatars)').all() as {name:string}[]).map(c => c.name);
      if (!columns.includes('retry_at')) db.exec('ALTER TABLE avatars ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0');
      if (!columns.includes('status')) {
        db.exec("ALTER TABLE avatars ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'");
        db.exec("UPDATE avatars SET status='ready' WHERE filename IS NOT NULL");
      }
      for (const row of db.prepare('SELECT key,value FROM settings').all() as {key:string;value:string}[]) {
        let parsed: unknown;
        try { parsed = JSON.parse(row.value); } catch { continue; }
        const scrubbed = JSON.stringify(withoutPhone(parsed));
        if (scrubbed !== row.value) db.prepare('UPDATE settings SET value=? WHERE key=?').run(scrubbed, row.key);
      }
      for (const row of db.prepare('SELECT id,data FROM participants').all() as {id:string;data:string}[]) {
        const scrubbed = JSON.stringify(withoutPhone(JSON.parse(row.data)));
        if (scrubbed !== row.data) db.prepare('UPDATE participants SET data=? WHERE id=?').run(scrubbed, row.id);
      }
      db.exec('PRAGMA user_version=1');
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}
