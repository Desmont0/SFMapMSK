import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { config } from './config.ts';
import { db } from './db.ts';
import { telegramDownload } from './telegram-network.ts';
import { withTelegramProxy } from './telegram-proxies.ts';
import type { AvatarState, Participant } from '../shared/participant.ts';
export { allowedAvatarHost, isPublicIP } from './telegram-network.ts';

type AvatarRow = { filename: string | null; checked: number; retry_at: number; status: AvatarState['status'] };
function avatarFilename(username: string) {
  return createHash('sha256').update(username).digest('hex').slice(0, 32) + '.webp';
}
export function telegramAvatarImage(html: string): string | null {
  const tags = html.match(/<meta\s[^>]*>/gi) || [];
  const tag = tags.find(t => /(?:property|name)=["']og:image["']/i.test(t));
  const imageUrl = tag?.match(/content=["']([^"']+)["']/i)?.[1]?.replaceAll('&amp;', '&');
  if (!imageUrl) return null;
  const url = new URL(imageUrl);
  if (url.hostname === 'telegram.org' && /^\/img\/(?:t_logo|telegram_logo)/i.test(url.pathname)) return null;
  return imageUrl;
}
export function avatarFor(telegram: string) {
  const username = telegram.split('/').pop()!.toLowerCase();
  const row = db.prepare('SELECT filename,checked FROM avatars WHERE username=?').get(username) as AvatarRow | undefined;
  if (!row?.filename) return null;
  const hashed = avatarFilename(username);
  if (row.filename !== hashed) {
    const dir = path.join(config.dataDir, 'avatars');
    const oldPath = path.join(dir, row.filename);
    const newPath = path.join(dir, hashed);
    try {
      if (fsSync.existsSync(oldPath)) {
        if (!fsSync.existsSync(newPath)) fsSync.renameSync(oldPath, newPath);
        else fsSync.unlinkSync(oldPath);
      }
      db.prepare('UPDATE avatars SET filename=? WHERE username=?').run(hashed, username);
    } catch { return null; }
  }
  return '/avatars/' + hashed + '?v=' + row.checked;
}

let running: Promise<void> | null = null;
const pending = new Map<string, { participant: Participant; force: boolean }>();
const active = new Set<string>();
export function avatarState(telegram: string): AvatarState {
  const username = telegram.split('/').pop()!.toLowerCase();
  const row = db.prepare('SELECT checked,status FROM avatars WHERE username=?').get(username) as AvatarRow | undefined;
  return { status:pending.has(username) || active.has(username) ? 'loading' : row?.status || 'idle', checkedAt:row?.checked || null };
}

async function refreshOne(p: Participant, force: boolean) {
  const username = p.telegram.split('/').pop()!.toLowerCase();
  if (!/^[a-z][a-z0-9_]{3,31}$/.test(username)) return;
  avatarFor(p.telegram); // Migrate cached filenames before checking the retry deadline.
  const old = db.prepare('SELECT filename,checked,retry_at FROM avatars WHERE username=?').get(username) as AvatarRow | undefined;
  if (!force && old && (old.retry_at ? Date.now() < old.retry_at : Date.now() - old.checked < 86400000)) return;
  const dir = path.join(config.dataDir, 'avatars'); await fs.mkdir(dir, { recursive: true });
  let filename = old?.filename || null;
  let failure: string | null = null;
  try {
    const bytes = await withTelegramProxy(async proxy => {
      const page = await telegramDownload('https://t.me/' + username, 512 * 1024, proxy);
      if (page.type !== 'text/html') throw new Error('Invalid Telegram page');
      const imageUrl = telegramAvatarImage(page.bytes.toString('utf8'));
      if (!imageUrl) return null;
      const image = await telegramDownload(imageUrl, 3 * 1024 * 1024, proxy);
      if (!['image/jpeg','image/png','image/webp'].includes(image.type)) throw new Error('Invalid avatar format');
      return sharp(image.bytes, { limitInputPixels: 16000000, animated: false }).resize(160,160,{fit:'cover'}).webp({quality:82}).toBuffer();
    });
    if (bytes) {
      filename = avatarFilename(username); const temp = path.join(dir, filename + '.tmp');
      await fs.writeFile(temp, bytes); await fs.rename(temp, path.join(dir, filename));
    } else filename = null;
  } catch (error) { failure = error instanceof Error ? error.message : 'Avatar unavailable'; }
  if (process.env.SFMAP_AVATAR_DIAGNOSTIC === 'true' && failure) console.warn('Telegram avatar diagnostic [' + username + ']: ' + failure);
  const checked = Date.now();
  db.prepare('INSERT INTO avatars(username,checked,filename,retry_at,status) VALUES(?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET checked=excluded.checked,filename=excluded.filename,retry_at=excluded.retry_at,status=excluded.status')
    .run(username, checked, filename, checked + (failure ? 15*60*1000 : 86400000), failure ? 'error' : filename ? 'ready' : 'unavailable');
}

export function refreshAvatars(participants: Participant[], options: { force?: boolean } = {}): Promise<void> {
  for (const p of participants) {
    const username = p.telegram.split('/').pop()?.toLowerCase();
    if (username) pending.set(username, { participant: p, force: !!options.force || !!pending.get(username)?.force });
  }
  if (running) return running;
  running = (async () => {
    while (pending.size) {
      const username = pending.keys().next().value!;
      const { participant, force } = pending.get(username)!; pending.delete(username);
      active.add(username);
      try { await refreshOne(participant, force); } finally { active.delete(username); }
    }
  })().finally(() => { running = null; });
  return running;
}
