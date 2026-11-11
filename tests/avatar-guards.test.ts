import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIP, allowedAvatarHost, normalizeLocalProxy, normalizePublicProxy, telegramDownload } from '../server/telegram-network.ts';
import { parseLocalProxy, parseProxyList, TelegramProxyPool } from '../server/telegram-proxies.ts';
test('avatar fetch accepts Telegram hosts and rejects private, loopback and mapped addresses', () => {
    for (const host of ['t.me','cdn1.telesco.pe','cdn5.telesco.pe','foo.cdn-telegram.org']) assert.equal(allowedAvatarHost(host), true, host);
    for (const host of ['localhost','127.0.0.1','t.me.evil.test','evil-t.me','cdn1.telesco.pe.evil.test','evil.example']) assert.equal(allowedAvatarHost(host), false, host);
    for (const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','ff02::1','2001:db8::1']) assert.equal(isPublicIP(ip), false, ip);
    for (const ip of ['8.8.8.8','149.154.167.99','2606:4700::1111']) assert.equal(isPublicIP(ip), true, ip);
});

test('public proxy configuration rejects local endpoints, credentials and malformed routes', async () => {
  for (const value of ['http://127.0.0.1:8080','socks5://10.0.0.1:1080','http://169.254.169.254:80','http://localhost:8080','http://example.com:8080','ftp://8.8.8.8:21','http://user:pass@8.8.8.8:8080','http://8.8.8.8:8080/path','http://8.8.8.8:8080?url=x','socks5://8.8.8.8']) {
    assert.throws(() => normalizePublicProxy(value), Error, value);
  }
  assert.equal(normalizePublicProxy('http://8.8.8.8:80'),'http://8.8.8.8');
  assert.equal(normalizePublicProxy('https://8.8.8.8:443'),'https://8.8.8.8');
  assert.deepEqual(parseProxyList(['socks5://8.8.8.8:1080','socks5://8.8.8.8:1080']),['socks5://8.8.8.8:1080']);
  assert.throws(() => parseProxyList(Array(101).fill('http://8.8.8.8:80')));
  assert.throws(() => parseProxyList(['http://8.8.8.8:80',42]));
  for (const url of ['http://t.me/user','https://127.0.0.1/x','https://t.me.evil.test/avatar','https://t.me:8443/user','https://user:pass@t.me/user']) {
    await assert.rejects(telegramDownload(url,1024,null), /Disallowed avatar URL/);
  }
});

test('local HTTP/SOCKS proxy is restricted to localhost', () => {
  assert.equal(normalizeLocalProxy('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(parseLocalProxy('socks5://localhost:1080'), 'socks5://localhost:1080');
  assert.throws(() => normalizeLocalProxy('http://8.8.8.8:8080'), Error);
});

test('Telegram proxy failover prefers the working tunnel and suspends failed proxies without direct fallback', async () => {
  let now = 1000; const pool = new TelegramProxyPool(() => now);
  const proxies = ['http://8.8.8.8:8080','socks5://1.1.1.1:1080'];
  const calls:string[]=[];
  const operation = async (proxy:string) => {calls.push(proxy);if(proxy===proxies[0])throw new Error('offline');return 'image';};
  assert.equal(await pool.run(proxies,operation),'image');
  assert.deepEqual(calls,proxies); calls.length=0;
  assert.equal(await pool.run(proxies,operation),'image');
  assert.deepEqual(calls,[proxies[1]]);
  await assert.rejects(pool.run(proxies,async () => {throw new Error('offline');}), /offline/);
  calls.length=0;
  await assert.rejects(pool.run(proxies,operation), /No available Telegram proxy/);
  assert.deepEqual(calls,[]);
  now += 10*60*1000+1;
  assert.equal(await pool.run(proxies,operation),'image');
});
