import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// A disposable SQLite database; never use the workspace or production data.
process.env.DATA_DIR=await mkdtemp(path.join(os.tmpdir(),'sfmap-browser-'));
process.env.SECRETS_DIR=path.join(process.env.DATA_DIR,'secrets');
Object.assign(process.env,{PORT:'18765',HOST:'127.0.0.1',PUBLIC_ORIGIN:'http://127.0.0.1:18765',SHARE_PORT:'0',MAP_CACHE_AUTO:'false',ADMIN_ALLOW_IPS:'',TLS_CERT_FILE:'',TLS_KEY_FILE:'',COOKIE_SECURE:'false'});
const {db,setSetting}=await import('../server/db.ts');
const {Repository}=await import('../server/repository.ts');
const {emptyParticipant}=await import('../shared/participant.ts');
const repo=new Repository();await repo.initialize();
const person=(await repo.mutate('create',{...emptyParticipant,name:'Александр Тест',locationId:'moscow-137',plate:'А123АА 777',market:'JDM',transmission:'АКПП',exactLatitude:55.85,exactLongitude:37.7,comment:'Сайт https://example.com/test. <img src=x onerror=alert(1)> javascript:alert(1)'}))!;
await repo.mutate('create',{...emptyParticipant,kind:'garage',name:'Гараж Александра',ownerId:person.id,locationId:'moscow-137',exactLatitude:55.85,exactLongitude:37.5});
await repo.mutate('create',{...emptyParticipant,kind:'service',name:'Сервис Тест',locationId:'moscow-137',exactLatitude:55.7,exactLongitude:37.8});
await repo.mutate('create',{...emptyParticipant,kind:'meetup',name:'Место встречи Тест',locationId:'moscow-137',exactLatitude:55.7,exactLongitude:37.8});
setSetting('admin',{path:'/manage-browser-test'});
db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update('browser-test-session').digest('hex'),'browser-test-csrf',Date.now()+3600000);
await import('../server/index.ts');
