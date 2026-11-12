import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { db } from './db.ts';

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export function photoFor(id: string) {
  const row = db.prepare('SELECT version FROM photos WHERE participant_id=?').get(id) as {version:string}|undefined;
  return row ? '/photos/' + id + '.webp?v=' + row.version : null;
}
export async function savePhoto(id: string, input: Buffer) {
  if (!input.length || input.length > MAX_PHOTO_BYTES) throw Object.assign(new Error('Фото должно быть не больше 12 МБ'), {status:413});
  let data: Buffer;
  try {
    const image = sharp(input, {limitInputPixels:40_000_000, animated:false, failOn:'warning'});
    const metadata = await image.metadata();
    if (!['jpeg','png','webp','heif','avif'].includes(metadata.format || '') || (metadata.pages || 1) > 1) throw new Error('Unsupported image');
    data = await image.rotate().resize({width:1280,height:720,fit:'inside',withoutEnlargement:true}).webp({quality:80,effort:4}).toBuffer();
  } catch { throw Object.assign(new Error('Не удалось прочитать фото. Выберите обычное изображение JPEG, PNG, WebP или AVIF до 40 мегапикселей.'), {status:400}); }
  if (!db.prepare('SELECT 1 FROM participants WHERE id=?').get(id)) throw Object.assign(new Error('Запись не найдена'), {status:404});
  const version = randomBytes(8).toString('hex');
  db.prepare('INSERT INTO photos(participant_id,data,version) VALUES(?,?,?) ON CONFLICT(participant_id) DO UPDATE SET data=excluded.data,version=excluded.version').run(id,data,version);
  return photoFor(id);
}
