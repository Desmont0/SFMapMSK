import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, SCHEMA_VERSION } from '../server/migrations.ts';

test('legacy populated database migrates atomically and preserves users, revisions and admin access', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE participants (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, revision TEXT NOT NULL); CREATE TABLE avatars (username TEXT PRIMARY KEY, checked INTEGER NOT NULL, filename TEXT)');
    const admin = JSON.stringify({ path:'/manage-existing', publicKey:{kid:'existing'}, passwordHash:'existing-hash' });
    db.prepare('INSERT INTO settings VALUES (?,?)').run('admin', admin);
    db.prepare('INSERT INTO participants VALUES (?,?,?,?)').run('existing', JSON.stringify({name:'Участник',plate:'А123АА 777'}), '2026-01-01', 'revision-1');
    db.prepare('INSERT INTO avatars VALUES (?,?,?)').run('existing', 100, 'cached.webp');
    const before = db.prepare('SELECT * FROM participants').all();
    migrateDatabase(db);
    migrateDatabase(db);
    assert.deepEqual(db.prepare('SELECT * FROM participants').all(), before);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='admin'").get()!.value, admin);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT status FROM avatars').get()!.status, 'ready');
  } finally { db.close(); }
});

test('a failed migration rolls back DDL, data and version; newer schemas are rejected without changes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE participants (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, revision TEXT NOT NULL)');
    db.prepare('INSERT INTO participants VALUES (?,?,?,?)').run('broken', 'invalid JSON', 'before', 'before');
    assert.throws(() => migrateDatabase(db));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='settings'").get()!.n, 0);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 0);
    assert.equal(db.prepare('SELECT data FROM participants').get()!.data, 'invalid JSON');
    db.exec('PRAGMA user_version=999');
    const before = db.prepare('SELECT * FROM sqlite_master').all();
    assert.throws(() => migrateDatabase(db), /более новой/);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master').all(), before);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 999);
  } finally { db.close(); }
});
