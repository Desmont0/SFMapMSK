import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptyParticipant } from '../shared/participant.ts';

process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'sfmap-privacy-'));

test('legacy phones are purged from SQLite and cannot be persisted through settings or CRUD', async () => {
  const dir = process.env.DATA_DIR!;
  const marker = 'LEGACY-PHONE-DO-NOT-STORE';
  const old = { ...emptyParticipant, name: 'Миграция', telegram: 'https://t.me/sfmap_test', locationId: 'moscow-137', phone: marker };
  const seed = new DatabaseSync(path.join(dir, 'sfmap.sqlite'));
  seed.exec('PRAGMA journal_mode=WAL; CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE participants (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, revision TEXT NOT NULL)');
  seed.prepare('INSERT INTO settings VALUES (?,?)').run('old-cache', JSON.stringify({ participants: [old], nested: { phone: marker, keep: 'yes' } }));
  seed.prepare('INSERT INTO participants VALUES (?,?,?,?)').run('legacy', JSON.stringify(old), '2026-01-01T00:00:00Z', 'legacy-revision');
  seed.close();
  const { db, setting, setSetting } = await import('../server/db.ts');
  const { Repository } = await import('../server/repository.ts');
  try {
    const cached = setting<any>('old-cache');
    assert.equal('phone' in cached.participants[0], false);
    assert.deepEqual(cached.nested, { keep: 'yes' });
    setSetting('new-cache', { phone: marker, array: [{ phone: marker, keep: 1 }] });
    assert.deepEqual(setting('new-cache'), { array: [{ keep: 1 }] });
    const repo = new Repository(); await repo.initialize();
    assert.equal(repo.snapshot.participants.length, 1);
    assert.equal('phone' in repo.snapshot.participants[0], false);
    await repo.mutate('create', old);
    await repo.mutate('update', old, 'legacy', 'legacy-revision');
    for (const row of db.prepare('SELECT data FROM participants').all() as {data:string}[]) {
      assert.equal(row.data.includes(marker), false);
      assert.equal('phone' in JSON.parse(row.data), false);
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.equal((await readFile(path.join(dir, 'sfmap.sqlite'))).includes(Buffer.from(marker)), false, 'old bytes are removed from SQLite pages');
    assert.equal((await readFile(path.join(dir, 'sfmap.sqlite-wal'))).length, 0);
  } finally { db.close(); }
});
