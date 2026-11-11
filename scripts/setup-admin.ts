import { generateKeyPair, exportJWK, CompactEncrypt } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db, setSetting, audit } from '../server/db.ts';
import { config } from '../server/config.ts';
import { passwordHash } from '../server/auth.ts';
let password = process.env.SFMAP_ADMIN_PASSWORD;
if (process.argv.includes('--password-stdin')) {
  let value = '';
  for await (const chunk of stdin) {
    value += chunk.toString();
    if (value.length > 4096) throw new Error('Слишком длинный пароль');
  }
  password = value.replace(/\r?\n$/, '');
}
if (!password) {
  const prompt = createInterface({ input: stdin, output: stdout });
  console.log('Ввод пароля виден в консоли. Для скрытого ввода используйте SFMAP_ADMIN_PASSWORD через окружение.');
  password = await prompt.question('Новый пароль администратора (не менее 12 символов): ');
  const confirm = await prompt.question('Повторите пароль: '); prompt.close();
  if (confirm !== password) throw new Error('Пароли не совпадают');
}
if (password.length < 12 || password.length > 1024) throw new Error('Пароль должен содержать от 12 до 1024 символов');
const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
const keyId = randomUUID();
const privateJwk = await exportJWK(privateKey); privateJwk.kid = keyId;
const encrypted = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(privateJwk)))
  .setProtectedHeader({ alg: 'PBES2-HS512+A256KW', enc: 'A256GCM', p2c: 210000, typ: 'sfmap-admin-key+jwe' }).encrypt(new TextEncoder().encode(password));
const secretDir = config.secretDir; await fs.mkdir(secretDir, { recursive: true });
const keyPath = path.join(secretDir, 'admin-' + keyId + '.key.jwe'); await fs.writeFile(keyPath, encrypted, { mode: 0o600 });
const adminPath = '/manage-' + randomBytes(24).toString('hex');
const passwordSalt = randomBytes(32).toString('hex');
const publicJwk = await exportJWK(publicKey);
db.exec('BEGIN IMMEDIATE');
try { setSetting('admin', { path: adminPath, keyId, publicKey: publicJwk, passwordSalt, passwordHash: passwordHash(password, passwordSalt) }); db.exec('DELETE FROM sessions; DELETE FROM challenges; COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
audit('admin_key_issued');
await fs.writeFile(path.join(secretDir, 'admin-access.txt'), 'Адрес: ' + config.origin + adminPath + '\nФайл-ключ: ' + keyPath + '\nПароль храните отдельно. Старые ключи и сессии отозваны.\n', { mode: 0o600 });
console.log('Адрес админки: ' + config.origin + adminPath + '\nФайл-ключ: ' + keyPath + '\nПрежний ключ и все сессии отозваны.');
db.close();
