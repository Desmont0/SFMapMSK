import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { emptyParticipant } from '../shared/participant.ts';
process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(),'sfmap-avatar-cache-'));
process.env.TELEGRAM_TRANSPORT = 'proxy';
process.env.TELEGRAM_PROXY_URLS = '';
process.env.TELEGRAM_PROXY_FILE = path.join(process.env.DATA_DIR,'missing-proxies.json');
const { db } = await import('../server/db.ts');
const { refreshAvatars, avatarFor, avatarState, telegramAvatarImage } = await import('../server/avatars.ts');
after(() => db.close());

test('private Telegram profiles have no photo; public photos retain their URL', () => {
  assert.equal(telegramAvatarImage('<meta property="og:image" content="https://telegram.org/img/t_logo_2x.png">'), null);
  assert.equal(telegramAvatarImage('<meta name="og:image" content="https://telegram.org/img/telegram_logo.png">'), null);
  assert.equal(telegramAvatarImage('<meta property="og:title" content="Oleg">'), null);
  assert.equal(telegramAvatarImage('<meta content="https://cdn1.telesco.pe/file/photo.jpg?a=1&amp;b=2" property="og:image">'), 'https://cdn1.telesco.pe/file/photo.jpg?a=1&b=2');
});

test('Telegram outage preserves the cached photo and schedules a shorter retry', async () => {
    const dir=path.join(process.env.DATA_DIR!,'avatars'); await mkdir(dir);
    const filename=createHash('sha256').update('telegram').digest('hex').slice(0,32)+'.webp';
    const photo=Buffer.from('previous-photo');await writeFile(path.join(dir,'telegram.webp'),photo);
    db.prepare('INSERT INTO avatars(username,checked,filename,retry_at) VALUES(?,?,?,?)').run('telegram',0,'telegram.webp',0);
    await refreshAvatars([{...emptyParticipant,telegram:'https://t.me/telegram',id:'test',updatedAt:'',revision:''}]);
    const avatar=avatarFor('https://t.me/telegram');
    assert.match(avatar || '', /^\/avatars\/[a-f0-9]{32}\.webp\?v=\d+$/);
    assert.equal((avatar || '').includes('telegram'), false);
    assert.deepEqual(await readFile(path.join(dir,filename)),photo);
    await assert.rejects(access(path.join(dir,'telegram.webp')), {code:'ENOENT'});
    assert.equal((db.prepare('SELECT filename FROM avatars WHERE username=?').get('telegram') as {filename:string}).filename,filename);
    const row=db.prepare('SELECT checked,retry_at FROM avatars WHERE username=?').get('telegram') as {checked:number;retry_at:number};
    assert.ok(row.retry_at-row.checked>=14*60*1000 && row.retry_at-row.checked<=16*60*1000);
    await refreshAvatars([{...emptyParticipant,telegram:'https://t.me/telegram',id:'test',updatedAt:'',revision:''}]);
    assert.deepEqual(db.prepare('SELECT checked,retry_at FROM avatars WHERE username=?').get('telegram'),row);
});

test('avatar queue processes new links queued during a refresh and forced saves bypass the retry deadline', async () => {
  const participant = (username: string) => ({...emptyParticipant,telegram:'https://t.me/'+username,id:username,updatedAt:'',revision:''});
  const first = refreshAvatars([participant('queue_first')]);
  const second = refreshAvatars([participant('queue_second')]);
  assert.equal(first, second, 'callers wait for the whole queue');
  assert.equal(avatarState('https://t.me/queue_first').status, 'loading');
  assert.equal(avatarState('https://t.me/queue_second').status, 'loading');
  await second;
  for (const username of ['queue_first','queue_second']) {
    assert.ok(db.prepare('SELECT checked FROM avatars WHERE username=?').get(username), 'queued link was processed: '+username);
    assert.equal(avatarState('https://t.me/'+username).status, 'error');
  }
  const checked = 123;
  db.prepare('UPDATE avatars SET checked=?,retry_at=? WHERE username=?').run(checked,Date.now()+86400000,'queue_second');
  await refreshAvatars([participant('queue_second')]);
  assert.equal((db.prepare('SELECT checked FROM avatars WHERE username=?').get('queue_second') as {checked:number}).checked,checked);
  await refreshAvatars([participant('queue_second')], {force:true});
  assert.ok((db.prepare('SELECT checked FROM avatars WHERE username=?').get('queue_second') as {checked:number}).checked > checked);
});
