import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyParticipant } from '../shared/participant.ts';

process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'sfmap-repository-'));
const { db } = await import('../server/db.ts');
const { Repository } = await import('../server/repository.ts');
after(() => db.close());

test('SQLite CRUD persists across instances, rejects stale writes and rolls back invalid input', async () => {
  const repo = new Repository();
  await repo.initialize();
  assert.deepEqual(repo.snapshot.participants, []);
  const input = { ...emptyParticipant, locationId: 'moscow-137', name: 'Участник', telegram: 'https://t.me/sfmap_test', plate: '00123' };
  const created = (await repo.mutate('create', input))!;
  assert.equal(created.city, 'Москва, Ясенево');
  assert.equal(created.plate, '00123');
  const second = new Repository();
  await second.initialize();
  assert.deepEqual(second.snapshot.participants, [created]);
  const edited = (await second.mutate('update', { ...input, name: 'Новое имя' }, created.id, created.revision))!;
  assert.notEqual(edited.revision, created.revision);
  assert.ok(edited.updatedAt > created.updatedAt);
  await assert.rejects(repo.mutate('update', input, created.id, created.revision), { status: 409 });
  await assert.rejects(repo.mutate('delete', undefined, created.id, created.revision), { status: 409 });
  await assert.rejects(repo.mutate('update', { ...input, locationId: 'invalid' }, created.id, edited.revision));
  await assert.rejects(repo.mutate('create', { ...input, name: '' }));
  await repo.refresh();
  assert.deepEqual(repo.snapshot.participants, [edited], 'failed writes leave stored data intact');
  await repo.mutate('delete', undefined, edited.id, edited.revision);
  assert.deepEqual(repo.snapshot.participants, []);
  await assert.rejects(repo.mutate('delete', undefined, edited.id, edited.revision), { status: 409 });
  assert.equal((await repo.mutate('create', input))!.name, input.name, 'a failed transaction releases its lock');
});
