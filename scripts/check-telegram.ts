import 'dotenv/config';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { emptyParticipant } from '../shared/participant.ts';
// A separate temporary cache keeps this diagnostic out of the running map.
process.env.SFMAP_AVATAR_DIAGNOSTIC = 'true';
process.env.TELEGRAM_PROXY_FILE ||= path.resolve(process.env.DATA_DIR || 'data', 'telegram-proxies.json');
process.env.DATA_DIR = await mkdtemp(path.join(os.tmpdir(), 'sfmap-telegram-'));
const { refreshAvatars, avatarFor } = await import('../server/avatars.ts');
const { db } = await import('../server/db.ts');
try {
  await refreshAvatars([{ ...emptyParticipant, name: 'Telegram', city: 'Москва', telegram: 'https://t.me/telegram', id: 'telegram-diagnostic', updatedAt: '', revision: '' }]);
  const avatar = avatarFor('https://t.me/telegram');
  if (!avatar) throw new Error('Фото не получено. Telegram может быть недоступен или изменить публичную страницу.');
  const file = path.join(process.env.DATA_DIR, new URL(avatar, 'http://localhost').pathname);
  const metadata = await sharp(file).metadata();
  const info = await stat(file);
  if (metadata.format !== 'webp' || metadata.width !== 160 || metadata.height !== 160) throw new Error('Unexpected processed avatar format');
  console.log(JSON.stringify({ status:'ok', transport:process.env.TELEGRAM_TRANSPORT || 'proxy', format:metadata.format, width:metadata.width, height:metadata.height, bytes:info.size }));
} finally { db.close(); }
