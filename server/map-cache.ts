import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.ts';

const UPSTREAM = 'https://tiles.openfreemap.org/';
const directory = path.join(config.dataDir,'map-cache');
const pending = new Map<string,Promise<Buffer>>();
export const cacheStatus = {running:false,ready:false,completed:0,total:0,failed:0,lastError:'',updatedAt:''};
const bounds = [34.7,54.1,41,57.2] as const;
function tileXY(lon:number,lat:number,z:number) {const n=2**z;return [Math.floor((lon+180)/360*n),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)];}
function tileBounds(z:number) {
  const [minX,maxY]=tileXY(bounds[0],bounds[1],z),[maxX,minY]=tileXY(bounds[2],bounds[3],z),n=2**z;
  return {minX:Math.max(0,minX-1),maxX:Math.min(n-1,maxX+1),minY:Math.max(0,minY-1),maxY:Math.min(n-1,maxY+1)};
}
export function allowedResource(resource:string) {
  if (resource.includes('..') || resource.includes('\\') || resource.includes('?') || resource.includes('#')) return false;
  if (new RegExp('^styles/(dark|positron)$').test(resource) || resource==='planet') return true;
  if (new RegExp('^sprites/[a-zA-Z0-9_-]+/ofm(?:@2x)?[.](json|png)$').test(resource)) return true;
  if (new RegExp('^fonts/Noto Sans (Regular|Bold|Italic)/(0-255|256-511|1024-1279|8192-8447)[.]pbf$').test(resource)) return true;
  const match=resource.match(new RegExp('^(?:planet/[a-zA-Z0-9_-]+|natural_earth/ne2sr)/([0-9]+)/([0-9]+)/([0-9]+)[.](pbf|png)$'));
  if(!match)return false;
  const z=Number(match[1]),x=Number(match[2]),y=Number(match[3]);
  if(z>12 || (resource.startsWith('natural_earth') && z>6))return false;
  const b=tileBounds(z);return x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY;
}
export async function cachedResource(resource:string):Promise<Buffer> {
  if (!allowedResource(resource)) throw Object.assign(new Error('Ресурс карты не найден'),{status:404});
  const filename=path.join(directory,createHash('sha256').update(resource).digest('hex'));
  try {return await fs.readFile(filename);} catch(error:any) {if(error.code!=='ENOENT')throw error;}
  if(pending.has(resource))return pending.get(resource)!;
  const operation=(async()=>{
    const response=await fetch(UPSTREAM+resource.split('/').map(encodeURIComponent).join('/'),{redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Сервис карты вернул '+response.status);
    const length=Number(response.headers.get('content-length')||0);
    if(length>16*1024*1024)throw new Error('Ресурс карты слишком большой');
    const chunks:Uint8Array[]=[];let size=0;
    const reader=response.body!.getReader();
    try {
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024){await reader.cancel();throw new Error('Ресурс карты слишком большой');}chunks.push(value);}
    } finally {reader.releaseLock();}
    const data=Buffer.concat(chunks);
    if(resource==='planet'||resource.startsWith('styles/')||resource.endsWith('.json'))JSON.parse(data.toString());
    await fs.mkdir(path.dirname(filename),{recursive:true});
    const temp=filename+'.'+randomBytes(6).toString('hex')+'.tmp';await fs.writeFile(temp,data);await fs.rename(temp,filename);
    return data;
  })();
  pending.set(resource,operation);try{return await operation;}finally{pending.delete(resource);}
}
// Keep the original style and TileJSON pinned on disk; every dependency uses the same server cache.
export function localResources(value:unknown):any {
  if(typeof value==='string'&&value.startsWith(UPSTREAM))return '/map-cache/'+value.slice(UPSTREAM.length);
  if(Array.isArray(value))return value.map(localResources);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,localResources(v)]));
  return value;
}
let warming:Promise<typeof cacheStatus>|null=null;
export function warmMapCache() {
  if(warming)return warming;
  warming=(async()=>{
    Object.assign(cacheStatus,{running:true,ready:false,completed:0,total:0,failed:0,lastError:''});
    try {
      const resources=new Set<string>(['styles/dark','styles/positron','planet']);
      for(const theme of ['dark','positron']) {
        const style=JSON.parse((await cachedResource('styles/'+theme)).toString());
        const sprite=String(style.sprite).replace(UPSTREAM,'');
        for(const suffix of ['.json','.png','@2x.json','@2x.png'])resources.add(sprite+suffix);
      }
      for(const font of ['Regular','Bold','Italic']) for(const range of ['0-255','256-511','1024-1279','8192-8447']) resources.add('fonts/Noto Sans '+font+'/'+range+'.pbf');
      const planet=JSON.parse((await cachedResource('planet')).toString());
      const template=String(planet.tiles[0]).replace(UPSTREAM,'');
      for(let z=0;z<=12;z++) {
        const b=tileBounds(z);
        for(let x=b.minX;x<=b.maxX;x++)for(let y=b.minY;y<=b.maxY;y++) {
          resources.add(template.replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y)));
          if(z<=6)resources.add(`natural_earth/ne2sr/${z}/${x}/${y}.png`);
        }
      }
      const queue=[...resources];cacheStatus.total=queue.length;
      await Promise.all(Array.from({length:4},async()=>{
        while(queue.length) {
          const resource=queue.shift()!;
          try {await cachedResource(resource);cacheStatus.completed++;}
          catch(error) {cacheStatus.failed++;cacheStatus.lastError=error instanceof Error?error.message:'Ошибка загрузки карты';}
        }
      }));
      cacheStatus.ready=cacheStatus.failed===0;
    } catch(error) {cacheStatus.lastError=error instanceof Error?error.message:'Ошибка загрузки карты';cacheStatus.failed++;}
    finally {
      cacheStatus.running=false;cacheStatus.updatedAt=new Date().toISOString();
      await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'status.json'),JSON.stringify(cacheStatus));
      warming=null;
    }
    return cacheStatus;
  })();
  return warming;
}
export async function mapCacheStatus() {
  if(!cacheStatus.running&&!cacheStatus.updatedAt)try{Object.assign(cacheStatus,JSON.parse(await fs.readFile(path.join(directory,'status.json'),'utf8')),{running:false});}catch{}
  return {...cacheStatus};
}
