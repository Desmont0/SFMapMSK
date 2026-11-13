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

test('garage owner links survive reload and prevent dangling or self references',async()=>{
  const repo=new Repository();await repo.initialize();
  const input={...emptyParticipant,locationId:'moscow-137',name:'Владелец'};
  const owner=(await repo.mutate('create',input))!;
  const garageInput={...input,kind:'garage' as const,name:'Гараж',ownerId:owner.id,exactLatitude:55.75123,exactLongitude:37.61123};
  const garage=(await repo.mutate('create',garageInput))!;
  const reopened=new Repository();await reopened.initialize();
  assert.equal(reopened.snapshot.participants.find(p=>p.id===garage.id)?.ownerId,owner.id);
  await assert.rejects(repo.mutate('create',{...garageInput,ownerId:'missing'}),{status:400});
  await assert.rejects(repo.mutate('create',{...garageInput,ownerId:garage.id}),{status:400});
  await assert.rejects(repo.mutate('delete',undefined,owner.id,owner.revision),{status:409});
  await assert.rejects(repo.mutate('update',{...input,kind:'garage'},owner.id,owner.revision),{status:409});
  await assert.rejects(repo.mutate('update',{...garageInput,ownerId:owner.id},owner.id,owner.revision),{status:400});
  await repo.mutate('update',{...garageInput,ownerId:''},garage.id,garage.revision);
  await repo.mutate('delete',undefined,owner.id,owner.revision);
});

test('legacy JSON records preserve exact places, IDs, links, photos and revisions on read',async()=>{
  const input={kind:'garage',name:'Гараж до обновления',locationId:'moscow-137',latitude:55.75123,longitude:37.61123,steering:'',transmission:''};
  db.prepare('INSERT INTO participants VALUES (?,?,?,?)').run('legacy-place',JSON.stringify(input),'2026-01-01','unchanged');
  db.prepare('INSERT INTO participant_links VALUES (?,?)').run('legacy-place','oldlink1');
  db.prepare('INSERT INTO photos(participant_id,data,version) VALUES(?,?,?)').run('legacy-place',Buffer.from('legacy-photo'),'old-photo');
  const repo=new Repository();await repo.initialize();
  const p=repo.snapshot.participants.find(p=>p.id==='legacy-place')!;
  assert.equal(p.exactLatitude,input.latitude);assert.equal(p.longitude,input.longitude);assert.equal(p.revision,'unchanged');assert.equal(p.shareId,'oldlink1');
  assert.equal(db.prepare('SELECT version FROM photos WHERE participant_id=?').get(p.id)!.version,'old-photo');
  assert.equal(db.prepare('SELECT data FROM participants WHERE id=?').get(p.id)!.data,JSON.stringify(input),'reading does not rewrite legacy records');
});
