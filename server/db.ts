import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { withoutPhone } from './privacy.ts';
fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'sfmap.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, participant_id TEXT);
CREATE TABLE IF NOT EXISTS avatars (username TEXT PRIMARY KEY, checked INTEGER NOT NULL, filename TEXT);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)),
  updated_at TEXT NOT NULL,
  revision TEXT NOT NULL
);`);
for (const row of db.prepare('SELECT key,value FROM settings').all() as {key:string;value:string}[]) {
  let parsed: unknown;
  try { parsed = JSON.parse(row.value); } catch { continue; }
  const scrubbed = withoutPhone(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(scrubbed)) db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(scrubbed), row.key);
}
for (const row of db.prepare('SELECT id,data FROM participants').all() as {id:string;data:string}[]) {
  const scrubbed = JSON.stringify(withoutPhone(JSON.parse(row.data)));
  if (scrubbed !== row.data) db.prepare('UPDATE participants SET data=? WHERE id=?').run(scrubbed, row.id);
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
if (!(db.prepare('PRAGMA table_info(avatars)').all() as {name:string}[]).some(column => column.name === 'retry_at')) {
  db.exec('ALTER TABLE avatars ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0');
}
if (!(db.prepare('PRAGMA table_info(avatars)').all() as {name:string}[]).some(column => column.name === 'status')) {
  db.exec("ALTER TABLE avatars ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'");
  db.exec("UPDATE avatars SET status='ready' WHERE filename IS NOT NULL");
}
export function setting<T>(key: string): T | null { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined; return r ? JSON.parse(r.value) : null; }
export function setSetting(key: string, value: unknown) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(withoutPhone(value))); }
export function audit(action: string, id: string | null = null) { db.prepare('INSERT INTO audit(at,action,participant_id) VALUES(?,?,?)').run(new Date().toISOString(), action, id); }
