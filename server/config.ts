import 'dotenv/config';
import path from 'node:path';
export const config = {
  port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1',
  origin: process.env.PUBLIC_ORIGIN || 'http://localhost:3000',
  sharePort: Number(process.env.SHARE_PORT || 0),
  shareHost: process.env.SHARE_HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  secure: process.env.COOKIE_SECURE === 'true',
  secretDir: path.resolve(process.env.SECRETS_DIR || 'secrets'),
  telegramTransport: process.env.TELEGRAM_TRANSPORT || 'proxy',
  telegramProxyMode: process.env.TELEGRAM_PROXY_MODE || 'external',
  telegramProxyUrls: process.env.TELEGRAM_PROXY_URLS || '',
  telegramProxyFile: path.resolve(process.env.TELEGRAM_PROXY_FILE || path.join(process.env.DATA_DIR || 'data','telegram-proxies.json')),
  telegramLocalProxyUrl: process.env.TELEGRAM_LOCAL_PROXY_URL || '',
};
if (!['proxy','direct'].includes(config.telegramTransport)) throw new Error('TELEGRAM_TRANSPORT must be proxy or direct');
if (!['external','local','auto'].includes(config.telegramProxyMode)) throw new Error('TELEGRAM_PROXY_MODE must be external, local or auto');
const origin = new URL(config.origin);
if (!['http:','https:'].includes(origin.protocol) || origin.origin !== config.origin) throw new Error('PUBLIC_ORIGIN must be an origin without a path or trailing slash');
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be between 1 and 65535');
if (!Number.isInteger(config.sharePort) || config.sharePort < 0 || config.sharePort > 65535 || config.sharePort === config.port) throw new Error('SHARE_PORT must be 0 (disabled) or a separate port between 1 and 65535');
