import 'dotenv/config';
import net from 'node:net';
import path from 'node:path';

function normalizeIp(value: string) { return value.replace(/^::ffff:/i, ''); }
const adminAllowIps = (process.env.ADMIN_ALLOW_IPS || '').split(',').map(value => normalizeIp(value.trim())).filter(Boolean);
if (adminAllowIps.some(value => net.isIP(value) === 0)) throw new Error('ADMIN_ALLOW_IPS must contain valid IP addresses separated by commas');
export const config = {
  port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1',
  origin: process.env.PUBLIC_ORIGIN || 'http://localhost:3000',
  sharePort: Number(process.env.SHARE_PORT || 0),
  shareHost: process.env.SHARE_HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || 'data'),
  secure: process.env.COOKIE_SECURE === 'true',
  tlsCert: process.env.TLS_CERT_FILE || '',
  tlsKey: process.env.TLS_KEY_FILE || '',
  secretDir: path.resolve(process.env.SECRETS_DIR || 'secrets'),
  adminAllowIps,
};
if (!!config.tlsCert !== !!config.tlsKey) throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be set together');
if (config.tlsCert && (!config.secure || !config.origin.startsWith('https://'))) throw new Error('TLS requires COOKIE_SECURE=true and an HTTPS PUBLIC_ORIGIN');
const origin = new URL(config.origin);
if (!['http:','https:'].includes(origin.protocol) || origin.origin !== config.origin) throw new Error('PUBLIC_ORIGIN must be an origin without a path or trailing slash');
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be between 1 and 65535');
if (!Number.isInteger(config.sharePort) || config.sharePort < 0 || config.sharePort > 65535 || config.sharePort === config.port) throw new Error('SHARE_PORT must be 0 (disabled) or a separate port between 1 and 65535');
export function isIpAllowed(remoteAddress: string | undefined, allowlist: readonly string[]) {
  if (!allowlist.length) return true;
  return !!remoteAddress && allowlist.includes(normalizeIp(remoteAddress));
}
export function isAdminIpAllowed(remoteAddress: string | undefined) { return isIpAllowed(remoteAddress, config.adminAllowIps); }
