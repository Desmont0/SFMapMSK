import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePublicProxy, telegramDownload } from '../server/telegram-network.ts';
import { config } from '../server/config.ts';

const sources = [
  {url:'https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt',prefix:''},
  {url:'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',prefix:'socks5://'},
  {url:'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',prefix:'http://'},
  {url:'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',prefix:'socks5://'},
  {url:'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',prefix:'http://'},
];
const candidates:string[][]=[];
for(const source of sources){
  try{
    const response=await fetch(source.url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const text=await response.text();if(text.length>1000000)throw new Error('List too large');
    candidates.push([...new Set(text.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).flatMap(v=>{try{return [normalizePublicProxy(source.prefix+v)];}catch{return [];}}))]);
  }catch(error){console.warn('Proxy list unavailable: '+(error as Error).message);}
}
const limit=Number(process.env.PROXY_PROBE_LIMIT||600), timeout=Number(process.env.PROXY_PROBE_TIMEOUT_MS||5000);
if(!Number.isInteger(limit)||limit<1||limit>15000||!Number.isFinite(timeout)||timeout<500||timeout>20000)throw new Error('Invalid probe limit or timeout');
const pool:string[]=[];
const seen=new Set<string>();
// Interleave protocols and sample across each list, instead of testing only the first entries.
for(let i=0;pool.length<limit&&candidates.some(c=>i<c.length);i++)for(const list of candidates){
  if(i<list.length&&pool.length<limit){const value=list[i];if(!seen.has(value)){seen.add(value);pool.push(value);}}
}
const found:{url:string;latencyMs:number}[]=[];let cursor=0,checked=0;
const failures=new Map<string,number>();
console.log('Checking up to '+pool.length+' public proxies, TLS verification enabled.');
async function worker(){
  while(cursor<pool.length&&found.length<5){const proxy=pool[cursor++];const started=Date.now();
    try{
      const page=await telegramDownload('https://t.me/telegram',512*1024,proxy,timeout);
      if(page.type!=='text/html'||!page.bytes.includes(Buffer.from('og:image')))throw new Error('Unexpected Telegram page');
      const tags=page.bytes.toString('utf8').match(/<meta\s[^>]*>/gi)||[];
      const imageUrl=tags.find(t=>/(?:property|name)=["']og:image["']/i.test(t))?.match(/content=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;','&');
      if(!imageUrl)throw new Error('No image');
      const photo=await telegramDownload(imageUrl,3*1024*1024,proxy,timeout);
      if(!['image/jpeg','image/png','image/webp'].includes(photo.type))throw new Error('Invalid image');
      found.push({url:proxy,latencyMs:Date.now()-started});console.log('Verified Telegram page + image through '+proxy);
    }catch(error){const reason=(error as Error).message;failures.set(reason,(failures.get(reason)||0)+1);}
    checked++;if(checked%40===0)console.log('Checked '+checked+', verified '+found.length);
  }
}
await Promise.all(Array.from({length:24},()=>worker()));
console.log('Failure counts: '+JSON.stringify(Object.fromEntries([...failures].sort((a,b)=>b[1]-a[1]).slice(0,8))));
if(!found.length){console.error('No working public proxy found in '+checked+' candidates. Existing configuration preserved.');process.exitCode=1;}
else{
  const file=path.resolve(process.env.TELEGRAM_PROXY_FILE||path.join(config.dataDir,'telegram-proxies.json'));
  await fs.mkdir(path.dirname(file),{recursive:true});
  const result={checkedAt:new Date().toISOString(),sources:sources.map(s=>s.url),proxies:found.sort((a,b)=>a.latencyMs-b.latencyMs).map(p=>p.url)};
  await fs.writeFile(file+'.tmp',JSON.stringify(result,null,2));await fs.rename(file+'.tmp',file);
  console.log('Saved '+found.length+' verified public proxies to '+file);
}
