import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export function allowedAvatarHost(host: string) {
  return host === 't.me' || /^cdn\d+\.telesco\.pe$/.test(host) || /^[a-z0-9-]+\.cdn-telegram\.org$/.test(host);
}
export function isPublicIP(ip: string) {
  if (net.isIP(ip) === 4) {
    const a = ip.split('.').map(Number);
    return !(a[0] === 0 || a[0] === 10 || a[0] === 127 || a[0] >= 224 ||
      (a[0] === 169 && a[1] === 254) || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && [0,168].includes(a[1])) || (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
      (a[0] === 198 && [18,19,51].includes(a[1])) || (a[0] === 203 && a[1] === 0));
  }
  return net.isIP(ip) === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:db8:/i.test(ip);
}
type ProxyScope = 'public' | 'local';
export function normalizeProxy(value: string, scope: ProxyScope = 'public'): string {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!['http:','https:','socks5:'].includes(url.protocol) ||
      (scope === 'public' ? !isPublicIP(host) : !localHost) ||
      (!url.port && !['http:','https:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) {
    throw new Error(scope === 'local'
      ? 'Локальный прокси должен иметь вид http://127.0.0.1:PORT, https://127.0.0.1:PORT или socks5://127.0.0.1:PORT'
      : 'Прокси должен иметь вид http://PUBLIC_IP:PORT, https://PUBLIC_IP:PORT или socks5://PUBLIC_IP:PORT');
  }
  return url.origin === 'null' ? url.protocol + '//' + url.host : url.origin;
}
export function normalizePublicProxy(value: string): string { return normalizeProxy(value, 'public'); }
export function normalizeLocalProxy(value: string): string { return normalizeProxy(value, 'local'); }
export type DownloadResult = { bytes: Buffer; type: string };
const destinations = new Map<string, { address: string; expires: number }>();
async function destination(host: string, timeoutMs: number) {
  const cached = destinations.get(host);
  if (cached && cached.expires > Date.now()) return cached.address;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([dns.lookup(host, { all:true }), new Promise<never>((_,reject) => {
    timer = setTimeout(() => reject(new Error('Telegram DNS timeout')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(a => !isPublicIP(a.address))) throw new Error('Non-public Telegram address');
  const address = (addresses.find(a => a.family === 4) || addresses[0]).address;
  destinations.set(host, {address, expires:Date.now()+60000});
  return address;
}
export async function telegramDownload(url: string, limit: number, proxy: string | null, timeoutMs = 10000, redirects = 0): Promise<DownloadResult> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !allowedAvatarHost(parsed.hostname)) throw new Error('Disallowed avatar URL');
  if (redirects > 2) throw new Error('Too many redirects');
  const started = Date.now();
  const address = await destination(parsed.hostname, timeoutMs);
  timeoutMs = Math.max(1, timeoutMs - (Date.now() - started));
  let proxyUrl: string | null = null;
  if (proxy) {
    const proxyParsed = new URL(proxy);
    const local = proxyParsed.hostname === 'localhost' || proxyParsed.hostname === '127.0.0.1' || proxyParsed.hostname === '::1';
    proxyUrl = normalizeProxy(proxy, local ? 'local' : 'public');
  }
  const controller = new AbortController();
  const agent = proxyUrl ? proxyUrl.startsWith('socks5:')
    ? new SocksProxyAgent(proxyUrl, {timeout:timeoutMs, socketOptions:{signal:controller.signal}})
    : new HttpsProxyAgent(proxyUrl, {timeout:timeoutMs, signal:controller.signal}) : new https.Agent({keepAlive:false});
  // CONNECT/SOCKS targets the validated IP. TLS still authenticates the Telegram hostname.
  // Public proxies receive only TLS tunnels; administrative requests never use this code.
  try {
    const result = await new Promise<DownloadResult | {redirect:string}>((resolve,reject) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error, value?: DownloadResult | {redirect:string}) => {
        if (finished) return; finished=true; clearTimeout(timer);
        if(error) reject(error); else resolve(value!);
      };
      const request = https.get({
        hostname:address, port:443, servername:parsed.hostname, path:parsed.pathname+parsed.search, agent,
        rejectUnauthorized:true, signal:controller.signal,
        headers:{host:parsed.hostname,'user-agent':'SFMap/1.0 (public Telegram avatar cache)',accept:'text/html,image/jpeg,image/png,image/webp','accept-encoding':'identity'},
      },response => {
        if([301,302,303,307,308].includes(response.statusCode || 0) && response.headers.location) {
          const location=new URL(response.headers.location,parsed).href;
          response.destroy(); finish(undefined,{redirect:location}); return;
        }
        if(response.statusCode !== 200 || Number(response.headers['content-length'] || 0)>limit) {
          response.destroy(); finish(new Error('Telegram HTTP '+response.statusCode)); return;
        }
        const chunks:Buffer[]=[];let size=0;
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){response.destroy();finish(new Error('Avatar too large'));return;}chunks.push(chunk);});
        response.on('end',()=>finish(undefined,{bytes:Buffer.concat(chunks),type:String(response.headers['content-type']||'').split(';')[0]}));
        response.on('error',error=>finish(error));
        response.on('aborted',()=>finish(new Error('Telegram response aborted')));
      });
      timer=setTimeout(()=>{finish(new Error('Telegram proxy timeout'));controller.abort();request.destroy();},timeoutMs);
      request.once('error',error=>finish(error));
    });
    if('redirect' in result) return telegramDownload(result.redirect,limit,proxy,timeoutMs,redirects+1);
    return result;
  } finally { controller.abort(); agent.destroy(); }
}
