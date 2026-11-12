import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { compactDecrypt, importJWK, SignJWT } from 'jose';

test('HTTPS admin login enforces the socket IP and ignores forwarded headers', {timeout:60000}, async () => {
  const root = process.cwd(), temp = await mkdtemp(path.join(os.tmpdir(),'sfmap-tls-'));
  const loader = pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href;
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0,'127.0.0.1',resolve));
  const port = (probe.address() as {port:number}).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const cert = path.join(temp,'tls.crt'), key = path.join(temp,'tls.key');
  const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
  const generated = spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',cert],{encoding:'utf8',env:{...process.env,MSYS_NO_PATHCONV:'1'}});
  assert.equal(generated.status,0,generated.stderr);
  await mkdir(path.join(temp,'dist')); await writeFile(path.join(temp,'dist/index.html'),'<!doctype html>TLS app');
  const origin = 'https://127.0.0.1:'+port, password = randomBytes(24).toString('base64url');
  const env = {...process.env,DATA_DIR:path.join(temp,'data'),SECRETS_DIR:path.join(temp,'secrets'),HOST:'127.0.0.1',PORT:String(port),SHARE_PORT:'0',PUBLIC_ORIGIN:origin,COOKIE_SECURE:'true',TLS_CERT_FILE:cert,TLS_KEY_FILE:key,ADMIN_ALLOW_IPS:'127.0.0.1',SFMAP_ADMIN_PASSWORD:password};
  const setup = spawnSync(process.execPath,['--import',loader,path.join(root,'scripts/setup-admin.ts')],{cwd:temp,env,encoding:'utf8'});
  assert.equal(setup.status,0,setup.stderr);
  const access = await readFile(path.join(temp,'secrets/admin-access.txt'),'utf8');
  const adminPath = new URL(access.match(/Адрес: (.+)/)![1]).pathname;
  const keyPath = access.match(/Файл-ключ: (.+)/)![1].trim();
  const ca = await readFile(cert);
  const request = (url:string, method='GET', body?:unknown, extra:Record<string,string>={}) => new Promise<{status:number;headers:IncomingHttpHeaders;body:string}>((resolve,reject) => {
    const req = https.request(origin+url,{method,ca,headers:{origin,'content-type':'application/json',...extra}},res => {
      let text=''; res.on('data',chunk => text+=chunk); res.on('end',() => resolve({status:res.statusCode!,headers:res.headers,body:text}));
    });
    req.setTimeout(2000,() => req.destroy(new Error('request timeout'))); req.on('error',reject);
    req.end(body===undefined?undefined:JSON.stringify(body));
  });
  let child:ReturnType<typeof spawn>|undefined, logs='';
  async function start() {
    child = spawn(process.execPath,['--import',loader,path.join(root,'server/index.ts')],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
    child.stdout!.on('data',v=>logs+=v); child.stderr!.on('data',v=>logs+=v);
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null) assert.fail(logs);
      try { if((await request('/api/health')).status===200)return; } catch {}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.fail('TLS server did not start: '+logs);
  }
  async function stop() { if(child && child.exitCode===null) { child.kill(); await new Promise<void>(resolve=>child!.once('exit',()=>resolve())); } }
  try {
    await start();
    assert.equal((await request(adminPath)).status,200);
    assert.equal((await request('/api/admin/session')).status,401);
    const challenge = await request('/api/admin/challenge','POST',{path:adminPath});
    assert.equal(challenge.status,200);
    const ch = JSON.parse(challenge.body);
    const decrypted = await compactDecrypt((await readFile(keyPath,'utf8')).trim(),new TextEncoder().encode(password),{keyManagementAlgorithms:['PBES2-HS512+A256KW'],maxPBES2Count:300000});
    const jwk = JSON.parse(new TextDecoder().decode(decrypted.plaintext));
    const proof = await new SignJWT({nonce:ch.nonce}).setProtectedHeader({alg:'EdDSA'}).setIssuer(jwk.kid).setAudience('sfmap-admin').setJti(ch.id).setIssuedAt().setExpirationTime('2m').sign(await importJWK(jwk,'EdDSA'));
    const login = await request('/api/admin/login','POST',{path:adminPath,password,proof});
    assert.equal(login.status,200,login.body);
    const cookie = login.headers['set-cookie']![0];
    assert.match(cookie,/; Secure/);
    assert.equal((await request('/api/admin/session','GET',undefined,{cookie:cookie.split(';')[0]})).status,200);
    await stop(); env.ADMIN_ALLOW_IPS='203.0.113.10'; await start();
    const spoof = {'x-forwarded-for':'203.0.113.10',forwarded:'for=203.0.113.10',cookie:cookie.split(';')[0]};
    for(const url of [adminPath,'/api/admin/session','/api/admin/participants']) assert.equal((await request(url,'GET',undefined,spoof)).status,404,url);
    for(const url of ['/api/admin/challenge','/api/admin/login']) assert.equal((await request(url,'POST',{path:adminPath,password,proof},spoof)).status,404,url);
    assert.equal((await request('/api/participants')).status,200);
  } finally { await stop(); }
});
