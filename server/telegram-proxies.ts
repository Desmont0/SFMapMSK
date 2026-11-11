import fs from 'node:fs/promises';
import { config } from './config.ts';
import { normalizeLocalProxy, normalizePublicProxy } from './telegram-network.ts';

export function parseProxyList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Proxy list must contain at most 100 URLs');
  return [...new Set(value.map(item => {
    if (typeof item !== 'string') throw new Error('Invalid proxy URL');
    return normalizePublicProxy(item);
  }))];
}
export function parseLocalProxy(value: string): string { return normalizeLocalProxy(value); }

// An operation includes both the Telegram page and its image.
export class TelegramProxyPool {
  private failedUntil = new Map<string, number>();
  private preferred: string | null = null;
  constructor(private clock = Date.now) {}
  async run<T>(proxies: string[], operation: (proxy: string) => Promise<T>): Promise<T> {
    const available = proxies.filter(proxy => (this.failedUntil.get(proxy) || 0) <= this.clock());
    available.sort((a,b) => Number(b === this.preferred) - Number(a === this.preferred));
    let lastError: unknown = new Error('No available Telegram proxy; run npm run proxies:refresh');
    for (const proxy of available.slice(0,3)) {
      try {
        const result = await operation(proxy);
        this.preferred = proxy; this.failedUntil.delete(proxy); return result;
      } catch (error) {
        lastError = error; this.failedUntil.set(proxy, this.clock() + 10 * 60 * 1000);
      }
    }
    for (const proxy of this.failedUntil.keys()) if (!proxies.includes(proxy)) this.failedUntil.delete(proxy);
    throw lastError;
  }
}

let cached: string[] = [], checked = 0;
let cachedLocal: string[] = [], localChecked = 0;
async function configuredProxies() {
  if (Date.now() - checked < 60000) return cached;
  let proxies: string[];
  if (config.telegramProxyUrls) proxies = parseProxyList(config.telegramProxyUrls.split(/[\s,]+/).filter(Boolean));
  else {
    try {
      if ((await fs.stat(config.telegramProxyFile)).size > 65536) throw new Error('Proxy file too large');
      const content = JSON.parse(await fs.readFile(config.telegramProxyFile,'utf8'));
      proxies = parseProxyList(content.proxies);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      proxies = [];
    }
  }
  checked = Date.now(); cached = proxies; return proxies;
}
function configuredLocalProxy() {
  if (Date.now() - localChecked < 60000) return cachedLocal;
  cachedLocal = config.telegramLocalProxyUrl ? [parseLocalProxy(config.telegramLocalProxyUrl)] : [];
  localChecked = Date.now();
  return cachedLocal;
}
const pool = new TelegramProxyPool();
export async function withTelegramProxy<T>(operation: (proxy: string | null) => Promise<T>) {
  if (config.telegramTransport === 'direct') return operation(null);
  const local = config.telegramProxyMode === 'external' ? [] : configuredLocalProxy();
  const external = config.telegramProxyMode === 'local' ? [] : await configuredProxies();
  return pool.run([...local, ...external], operation);
}
