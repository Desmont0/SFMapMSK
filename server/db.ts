import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { withoutPhone } from './privacy.ts';
import { migrateDatabase } from './migrations.ts';
fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'sfmap.sqlite'));
try { migrateDatabase(db); } catch (error) { db.close(); throw error; }
export function setting<T>(key: string): T | null { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined; return r ? JSON.parse(r.value) : null; }
export function setSetting(key: string, value: unknown) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(withoutPhone(value))); }
export function audit(action: string, id: string | null = null) { db.prepare('INSERT INTO audit(at,action,participant_id) VALUES(?,?,?)').run(new Date().toISOString(), action, id); }
