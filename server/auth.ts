import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { importJWK, jwtVerify, type JWK } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { db, setting, audit } from './db.ts';
import { config } from './config.ts';
export type AdminConfig = { path: string; publicKey: JWK; passwordSalt: string; passwordHash: string; keyId: string };
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function passwordHash(password: string, salt: string) { return scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex'); }
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.sfmap_session;
  const session = typeof token === 'string' ? db.prepare('SELECT csrf,expires FROM sessions WHERE token=?').get(hashToken(token)) as { csrf: string; expires: number } | undefined : undefined;
  if (!session || session.expires <= Date.now()) { res.status(401).json({ error: 'Войдите в админку' }); return; }
  res.locals.session = session; next();
}
export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (req.headers.origin !== config.origin || req.headers['x-csrf-token'] !== res.locals.session?.csrf) { res.status(403).json({ error: 'Проверка безопасности не пройдена. Перезагрузите страницу.' }); return; } next();
}
export function createChallenge() {
  db.prepare('DELETE FROM challenges WHERE expires < ? OR used=1').run(Date.now());
  const id = randomBytes(24).toString('base64url'), nonce = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO challenges(id,nonce,expires) VALUES(?,?,?)').run(id, nonce, Date.now() + 120000);
  return { id, nonce };
}
export async function authenticate(body: unknown, res: Response) {
  const admin = setting<AdminConfig>('admin');
  const data = (body && typeof body === 'object' ? body : {}) as { password?: unknown; proof?: unknown };
  const deny = (): never => { audit('login_failed'); throw Object.assign(new Error('Неверный пароль, файл-ключ или истёкший запрос. Повторите вход.'), { status: 401 }); };
  if (!admin || typeof data.password !== 'string' || data.password.length > 1024 || typeof data.proof !== 'string' || data.proof.length > 8192) return deny();
  const candidate = Buffer.from(passwordHash(data.password, admin.passwordSalt), 'hex');
  const validPassword = timingSafeEqual(candidate, Buffer.from(admin.passwordHash, 'hex'));
  let payload;
  try {
    const key = await importJWK(admin.publicKey, 'EdDSA');
    const verified = await jwtVerify(data.proof, key, { algorithms: ['EdDSA'], audience: 'sfmap-admin', issuer: admin.keyId, maxTokenAge: '2m', requiredClaims: ['exp','iat','jti'], clockTolerance: 3 });
    payload = verified.payload;
  } catch { return deny(); }
  if (setting<AdminConfig>('admin')?.keyId !== admin.keyId || typeof payload.jti !== 'string' || typeof payload.nonce !== 'string') return deny();
  const challenge = db.prepare('SELECT nonce,expires,used FROM challenges WHERE id=?').get(payload.jti) as { nonce: string; expires: number; used: number } | undefined;
  if (!challenge || challenge.used || challenge.expires <= Date.now() || challenge.nonce !== payload.nonce) return deny();
  const consumed = db.prepare('UPDATE challenges SET used=1 WHERE id=? AND used=0').run(payload.jti);
  if (!consumed.changes || !validPassword) return deny();
  const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token), csrf, Date.now() + 8 * 60 * 60 * 1000);
  res.cookie('sfmap_session', token, { httpOnly: true, sameSite: 'strict', secure: config.secure, path: '/api/admin', maxAge: 8 * 60 * 60 * 1000 });
  audit('login'); return { csrf };
}
