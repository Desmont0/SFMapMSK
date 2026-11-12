import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { compactDecrypt, importJWK, SignJWT, generateKeyPair } from 'jose';
import sharp from 'sharp';
import { emptyParticipant } from '../shared/participant.ts';
const root=process.cwd();
const tsx=pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href;
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;await new Promise<void>(r=>server.close(()=>r()));return port;}
test('production API: key authentication, protected fields, CRUD, conflicts, expiry and recovery', {timeout:90000}, async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'sfmap-test-'));await mkdir(path.join(temp,'dist'));await writeFile(path.join(temp,'dist/index.html'),'<!doctype html>Test app');
  const port=await freePort(), origin='http://127.0.0.1:'+port;
  let sharePort=await freePort();while(sharePort===port)sharePort=await freePort();
  const shareOrigin='http://127.0.0.1:'+sharePort;
  const password=randomBytes(24).toString('base64url');
  const env={...process.env,DATA_DIR:path.join(temp,'data'),SECRETS_DIR:path.join(temp,'secrets'),HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:origin,SHARE_PORT:String(sharePort),SHARE_HOST:'127.0.0.1',SFMAP_ADMIN_PASSWORD:password,COOKIE_SECURE:'false',MAP_CACHE_AUTO:'false'};
  function setup(){const r=spawnSync(process.execPath,['--import',tsx,path.join(root,'scripts/setup-admin.ts')],{cwd:temp,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  setup();
  async function access(){const text=await readFile(path.join(temp,'secrets/admin-access.txt'),'utf8');return {adminPath:new URL(text.match(/Адрес: (.+)/)![1]).pathname,keyPath:text.match(/Файл-ключ: (.+)/)![1].trim()};}
  let adminAccess=await access();
  const decrypted=await compactDecrypt((await readFile(adminAccess.keyPath,'utf8')).trim(),new TextEncoder().encode(password),{keyManagementAlgorithms:['PBES2-HS512+A256KW'],maxPBES2Count:300000});
  const jwk=JSON.parse(new TextDecoder().decode(decrypted.plaintext)), key=await importJWK(jwk,'EdDSA');decrypted.plaintext.fill(0);
  let logs='';let child:ReturnType<typeof spawn>|undefined;
  async function start(){child=spawn(process.execPath,['--import',tsx,path.join(root,'server/index.ts')],{cwd:temp,env,stdio:['ignore','pipe','pipe']});child.stdout?.on('data',v=>logs+=v);child.stderr?.on('data',v=>logs+=v);const deadline=Date.now()+30000;while(Date.now()<deadline){if(child.exitCode!==null)assert.fail('Server exited: '+logs);try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1500)})).ok)return;}catch{}await pause(150);}assert.fail('Server did not start: '+logs);}
  async function stop(){if(!child||child.exitCode!==null)return;child.kill();await new Promise<void>(resolve=>child!.once('exit',()=>resolve()));}
  async function request(url:string,method='GET',body?:unknown,extra:Record<string,string>={}){const response=await fetch(origin+'/api'+url,{method,headers:{'content-type':'application/json',origin,...extra},body:body===undefined?undefined:JSON.stringify(body)});return {response,body:await response.json() as any};}
  async function challenge(){const r=await request('/admin/challenge','POST',{path:adminAccess.adminPath});assert.equal(r.response.status,200);return r.body;}
  async function proof(ch:any,signingKey=key,kid=jwk.kid){return new SignJWT({nonce:ch.nonce}).setProtectedHeader({alg:'EdDSA'}).setIssuer(kid).setAudience('sfmap-admin').setJti(ch.id).setIssuedAt().setExpirationTime('2m').sign(signingKey);}
  async function login(){const ch=await challenge();const signed=await proof(ch);const r=await request('/admin/login','POST',{path:adminAccess.adminPath,password,proof:signed});assert.equal(r.response.status,200,JSON.stringify(r.body));return {cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.body.csrf,signed};}
  try{
    await start();
    assert.equal((await request('/admin/participants')).response.status,401);
    assert.equal((await fetch(origin+'/manage-incorrect')).status,404);
    assert.equal((await request('/admin/challenge','POST',{path:'/manage-incorrect'})).response.status,404);
    const publicBefore=await request('/participants');assert.equal(publicBefore.body.source,'sqlite');assert.equal(publicBefore.body.participants.length,0);
    assert.equal((await fetch(shareOrigin+'/')).status,200,'public map is served on the share port');
    assert.deepEqual(await (await fetch(shareOrigin+'/api/participants')).json(),publicBefore.body);
    for(const url of [adminAccess.adminPath,'/api/admin/session','/api/admin/participants','/secrets/admin-access.txt','/.env']) {
      assert.equal((await fetch(shareOrigin+url,{headers:{host:new URL(origin).host}})).status,404,'public port rejects '+url+' even with a local Host header');
    }
    assert.equal((await fetch(shareOrigin+'/api/admin/challenge',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({path:adminAccess.adminPath})})).status,404);
    assert.equal((await fetch(shareOrigin+'/api/participants',{method:'POST'})).status,404,'public port accepts reads only');
    for(const p of publicBefore.body.participants){assert.equal('telegram' in p,false);assert.equal('phone' in p,false);assert.equal('adminComment' in p,false);assert.equal('revision' in p,false);assert.ok(p.plate);assert.ok(p.comment);}
    const wrong=await challenge();assert.equal((await request('/admin/login','POST',{path:adminAccess.adminPath,password:'wrong-password',proof:await proof(wrong)})).response.status,401);
    const stranger=await generateKeyPair('EdDSA');const ch=await challenge();assert.equal((await request('/admin/login','POST',{path:adminAccess.adminPath,password,proof:await proof(ch,stranger.privateKey)})).response.status,401);
    const expired=await challenge();{const sql=new DatabaseSync(path.join(temp,'data/sfmap.sqlite'));sql.prepare('UPDATE challenges SET expires=? WHERE id=?').run(Date.now()-1000,expired.id);sql.close();}
    assert.equal((await request('/admin/login','POST',{path:adminAccess.adminPath,password,proof:await proof(expired)})).response.status,401);
    const session=await login();assert.equal((await request('/admin/login','POST',{path:adminAccess.adminPath,password,proof:session.signed})).response.status,401,'proof replay rejected');
    const headers={cookie:session.cookie,'x-csrf-token':session.csrf};
    assert.equal((await fetch(shareOrigin+'/api/admin/participants',{headers:{...headers,origin}})).status,404,'even a valid local admin session cannot use the public listener');
    const admin=await request('/admin/participants','GET',undefined,headers);assert.equal(admin.body.source,'sqlite');assert.deepEqual(admin.body.participants,[]);
    const input={...emptyParticipant,locationId:'moscow-137',name:'Тест безопасности',city:'Москва',telegram:'https://t.me/sfmap_test',plate:'00123',sunroof:'Да' as const,phone:'+7 111 222-33-44',comment:'<img src=x onerror=alert(1)>',adminComment:'DO-NOT-PUBLISH'};
    assert.equal((await request('/admin/participants','POST',input,{cookie:session.cookie})).response.status,403,'CSRF missing');
    assert.equal((await request('/admin/participants','POST',input,{...headers,origin:'https://evil.example'})).response.status,403,'wrong origin');
    assert.equal((await request('/admin/participants','POST',{...input,locationId:'unknown'},headers)).response.status,400,'unknown location rejected');
    const created=await request('/admin/participants','POST',{...input,city:'Precise address',latitude:59.93,longitude:30.31},headers);assert.equal(created.response.status,201,JSON.stringify(created.body));assert.equal(created.body.plate,'00123');assert.equal(created.body.city,'Москва, Ясенево');assert.equal(created.body.latitude,55.61563);assert.equal(created.body.longitude,37.53717);
    const id=created.body.id;
    assert.equal((await fetch(origin+'/api/admin/participants/'+id+'/photo',{method:'PUT',headers:{origin,'content-type':'application/octet-stream',cookie:session.cookie},body:Buffer.from('not-an-image')})).status,403,'photo upload requires CSRF');
    const sourcePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
    const photoResponse=await fetch(origin+'/api/admin/participants/'+id+'/photo',{method:'PUT',headers:{origin,'content-type':'application/octet-stream',cookie:session.cookie,'x-csrf-token':session.csrf},body:sourcePng});
    assert.equal(photoResponse.status,200);
    const photoBody=await photoResponse.json() as {avatar:string}; assert.match(photoBody.avatar,/^\/photos\//);
    const photoData=Buffer.from(await (await fetch(origin+photoBody.avatar)).arrayBuffer());
    assert.equal((await sharp(photoData).metadata()).format,'webp');
    assert.ok(photoData.length<sourcePng.length+5000);
    const photoCheck=await request('/admin/participants','GET',undefined,headers);
    const checkedParticipant=photoCheck.body.participants.find((p:any)=>p.id===id);
    assert.equal(checkedParticipant.avatar,photoBody.avatar);
    assert.equal('phone' in created.body,false,'legacy phone input is discarded');
    {const sql=new DatabaseSync(path.join(temp,'data/sfmap.sqlite'),{readOnly:true});try{const row=sql.prepare('SELECT data FROM participants WHERE id=?').get(id) as {data:string};assert.equal(row.data.includes(input.phone),false,'phone is never persisted');assert.equal(JSON.parse(row.data).adminComment,input.adminComment);}finally{sql.close();}}
    const privateRecord=(await request('/admin/participants','GET',undefined,headers)).body.participants.find((p:any)=>p.id===id);
    assert.equal(privateRecord.telegram,input.telegram);assert.equal(privateRecord.adminComment,input.adminComment);
    const publicAfter=await request('/participants');const visible=publicAfter.body.participants.find((p:any)=>p.id===id);assert.equal(visible.comment,input.comment);assert.equal(visible.plate,'00123');assert.equal(JSON.stringify(publicAfter.body).includes('DO-NOT-PUBLISH'),false);assert.equal(JSON.stringify(publicAfter.body).includes(input.phone),false);
    assert.equal('telegram' in visible,false);assert.equal(JSON.stringify(publicAfter.body).includes(input.telegram),false);assert.equal(visible.avatar,photoBody.avatar);
    assert.equal((await fetch(shareOrigin+'/p/'+created.body.shareId)).status,200,'short link serves the public app');
    const linked=await (await fetch(shareOrigin+'/api/participants/'+created.body.shareId)).json() as any; assert.equal(linked.id,id);assert.equal(linked.sunroof,'Да');
    const exported=await fetch(origin+'/api/admin/export.txt',{headers:{origin,...headers}});assert.equal(exported.status,200);const exportText=await exported.text();assert.match(exportText,/Тест безопасности/);assert.match(exportText,/Фото WebP \(base64\): [A-Za-z0-9+/=]+/);
    const garage=await request('/admin/participants','POST',{...emptyParticipant,kind:'garage',name:'Гараж тест',locationId:'moscow-137',address:'Тестовый адрес',latitude:55.61,longitude:37.53},headers);assert.equal(garage.response.status,201);assert.equal(garage.body.kind,'garage');assert.equal(garage.body.plate,'');
    assert.equal((await request('/admin/participants/'+id+'/photo','DELETE',{},headers)).response.status,200);
    const edited=await request('/admin/participants/'+id,'PUT',{...input,name:'Изменённый',revision:created.body.revision},headers);assert.equal(edited.response.status,200);
    assert.equal((await request('/admin/participants/'+id,'PUT',{...input,revision:created.body.revision},headers)).response.status,409,'stale revision rejected');
    assert.equal((await request('/admin/participants/'+id,'DELETE',{revision:created.body.revision},headers)).response.status,409);
    const audit=await request('/admin/audit','GET',undefined,headers);assert.equal(JSON.stringify(audit.body).includes('DO-NOT-PUBLISH'),false);assert.equal(JSON.stringify(audit.body).includes(password),false);
    await stop();await start();assert.ok((await request('/participants')).body.participants.some((p:any)=>p.id===id),'participant survives restart');
    assert.equal((await request('/admin/participants','GET',undefined,headers)).body.participants.find((p:any)=>p.id===id).avatar,null,'photo deletion survives restart');
    assert.equal((await request('/admin/participants/'+id,'DELETE',{revision:edited.body.revision},headers)).response.status,200);
    assert.equal((await request('/participants')).body.participants.some((p:any)=>p.id===id),false);
    {const sql=new DatabaseSync(path.join(temp,'data/sfmap.sqlite'));sql.prepare('UPDATE sessions SET expires=?').run(Date.now()-1000);sql.close();}
    assert.equal((await request('/admin/participants','GET',undefined,headers)).response.status,401,'expired session rejected');
    const active=await login();setup();adminAccess=await access();
    assert.equal((await request('/admin/participants','GET',undefined,{cookie:active.cookie})).response.status,401,'recovery revokes all sessions');
    const renewed=await challenge();assert.equal((await request('/admin/login','POST',{path:adminAccess.adminPath,password,proof:await proof(renewed)})).response.status,401,'old key rejected after recovery');
  }finally{await stop();}
});
