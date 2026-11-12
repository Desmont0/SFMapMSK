import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { config, isAdminIpAllowed } from './config.ts';
import { db, setting, audit } from './db.ts';
import { authenticate, createChallenge, requireAdmin, requireCsrf, hashToken, type AdminConfig } from './auth.ts';
import { Repository } from './repository.ts';
import { photoFor, savePhoto, MAX_PHOTO_BYTES } from './photos.ts';
import { exportText } from './export.ts';
import { cachedResource, localResources, warmMapCache, mapCacheStatus } from './map-cache.ts';
import { participantSchema, type PublicParticipant } from '../shared/participant.ts';
import { requireRegion } from './geography.ts';
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"], workerSrc: ["'self'", 'blob:'],
  fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null,
} }, strictTransportSecurity: false }));
app.use(express.json({ limit: '32kb' })); app.use(cookieParser());
app.use('/api', (_req,res,next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', rateLimit({ windowMs:60000, limit:180, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Слишком много запросов. Подождите минуту.'} }));
const loginLimit = rateLimit({ windowMs:15*60*1000, limit:15, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Слишком много попыток входа. Повторите через 15 минут.'} });
const repository = new Repository();
await repository.initialize();
const sync = async () => { try { await repository.refresh(); } catch { /* Keep last confirmed snapshot. */ } };
const timer = setInterval(() => void sync(), 60000); timer.unref();
if (process.env.MAP_CACHE_AUTO !== 'false') void warmMapCache().catch(error => console.warn('Map cache:',error.message));
const cacheTimer = setInterval(() => { if (process.env.MAP_CACHE_AUTO !== 'false') void warmMapCache().catch(() => {}); }, 30*60*1000); cacheTimer.unref();
app.get('/map-cache/{*resource}', async (req,res) => {
  const resource = req.path.slice('/map-cache/'.length);
  let decoded: string; try { decoded = decodeURIComponent(resource); } catch { res.sendStatus(404); return; }
  try {
    const data = await cachedResource(decoded);
    res.setHeader('Cache-Control','public, max-age=86400');
    if (decoded==='planet'||decoded.startsWith('styles/')||decoded.endsWith('.json')) res.json(localResources(JSON.parse(data.toString())));
    else res.type(decoded.endsWith('.png')?'image/png':'application/x-protobuf').send(data);
  } catch(error:any) {res.status(error.status||503).json({error:'Ресурс карты пока не загружен в кэш. Повторите позже.'});}
});
app.get('/photos/:file', (req,res) => {
  const id = String(req.params.file).match(/^([a-f0-9-]{36})\.webp$/)?.[1];
  const photo = id ? db.prepare('SELECT data FROM photos WHERE participant_id=?').get(id) as {data:Uint8Array}|undefined : undefined;
  if(!photo){res.sendStatus(404);return;}
  res.setHeader('Cache-Control','public, max-age=3600');res.type('image/webp').send(Buffer.from(photo.data));
});
app.get('/api/health', (_req,res) => res.json({ ok:true, source:'sqlite' }));
const publicParticipant = (p: (typeof repository.snapshot.participants)[number]): PublicParticipant => {
  const {telegram:_telegram,adminComment:_adminComment,revision:_revision,...visible}=p;
  return {...visible,avatar:photoFor(p.id)};
};
app.get('/api/participants', (_req,res) => {
  const participants = repository.snapshot.participants.map(publicParticipant);
  res.json({ participants, source:'sqlite', stale:!!repository.lastError, syncedAt:repository.snapshot.syncedAt });
});
app.get('/api/participants/:shareId', (req,res) => {
  const participant=repository.snapshot.participants.find(p=>p.shareId===req.params.shareId);
  if(!participant){res.status(404).json({error:'Запись не найдена'});return;}res.json(publicParticipant(participant));
});
const checkAccess: express.RequestHandler = (req,res,next) => {
  const admin = setting<AdminConfig>('admin');
  if (!isAdminIpAllowed(req.socket.remoteAddress) || !admin || req.body?.path !== admin.path || req.headers.origin !== config.origin) { res.status(404).json({error:'Адрес не найден'}); return; } next();
};
const requireAdminIp: express.RequestHandler = (req,res,next) => {
  if (!isAdminIpAllowed(req.socket.remoteAddress)) { res.status(404).json({error:'Адрес не найден'}); return; }
  next();
};
app.post('/api/admin/challenge', loginLimit, checkAccess, (_req,res) => res.json(createChallenge()));
app.post('/api/admin/login', loginLimit, checkAccess, async (req,res) => res.json(await authenticate(req.body,res)));
app.use('/api/admin', requireAdminIp);
app.use('/api/admin', requireAdmin);
app.get('/api/admin/session', (_req,res) => res.json({ csrf:res.locals.session.csrf, source:'sqlite' }));
const adminSnapshot = () => ({ ...repository.snapshot, participants:repository.snapshot.participants.map(p => ({ ...p, avatar:photoFor(p.id) })), source:'sqlite', error:repository.lastError });
app.get('/api/admin/participants', (_req,res) => res.json(adminSnapshot()));
app.get('/api/admin/map-cache', async (_req,res) => res.json(await mapCacheStatus()));
app.post('/api/admin/map-cache', requireCsrf, (_req,res) => {void warmMapCache().catch(() => {});res.status(202).json({ok:true});});
app.get('/api/admin/export.txt', async (_req,res) => {
  await repository.refresh();
  const photos=db.prepare('SELECT participant_id,data,version FROM photos').all() as {participant_id:string;data:Uint8Array;version:string}[];
  audit('data_exported');
  res.attachment('sfmap-'+new Date().toISOString().slice(0,10)+'.txt').type('text/plain; charset=utf-8').send(exportText(repository.snapshot.participants,photos));
});
app.post('/api/admin/refresh', requireCsrf, async (_req,res) => { await sync(); res.status(repository.lastError ? 503 : 200).json(adminSnapshot()); });
app.post('/api/admin/logout', requireCsrf, (req,res) => { db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(req.cookies.sfmap_session)); res.clearCookie('sfmap_session',{path:'/api/admin'}); audit('logout'); res.json({ok:true}); });
app.get('/api/admin/audit', (_req,res) => res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()));
app.put('/api/admin/participants/:id/photo', requireCsrf, express.raw({type:'application/octet-stream',limit:MAX_PHOTO_BYTES}), async (req,res) => {
  const participant = repository.snapshot.participants.find(p => p.id === req.params.id);
  if (!participant) { res.status(404).json({error:'Участник не найден'}); return; }
  if(!Buffer.isBuffer(req.body)){res.status(400).json({error:'Передайте файл фотографии'});return;}
  const avatar=await savePhoto(participant.id,req.body);audit('photo_uploaded',participant.id);res.json({avatar});
});
app.delete('/api/admin/participants/:id/photo', requireCsrf, (req,res) => {
  db.prepare('DELETE FROM photos WHERE participant_id=?').run(String(req.params.id));audit('photo_deleted',String(req.params.id));res.json({avatar:null});
});
app.post('/api/admin/participants', requireCsrf, async (req,res) => {
  const input = participantSchema.parse(req.body); requireRegion(input.latitude,input.longitude);
  const participant = await repository.mutate('create',input); audit('participant_created',participant?.id);
  res.status(201).json(participant && { ...participant, avatar:photoFor(participant.id) });
});
app.put('/api/admin/participants/:id', requireCsrf, async (req,res) => {
  const input = participantSchema.parse(req.body); requireRegion(input.latitude,input.longitude);
  const participant = await repository.mutate('update',input,String(req.params.id),req.body.revision); audit('participant_updated',String(req.params.id));
  res.json(participant && { ...participant, avatar:photoFor(participant.id) });
});
app.delete('/api/admin/participants/:id', requireCsrf, async (req,res) => { await repository.mutate('delete',undefined,String(req.params.id),req.body.revision); audit('participant_deleted',String(req.params.id)); res.json({ok:true}); });
app.use('/api', (_req,res) => res.status(404).json({error:'Адрес не найден'}));
const dist = path.resolve('dist');
if (fs.existsSync(path.join(dist,'index.html'))) {
  app.use(express.static(dist,{index:false,maxAge:'1h'}));
  app.get('/{*path}', (req,res) => {
    if (req.path === '/' || (/^\/p\/[A-Za-z0-9_-]{8}$/.test(req.path) && repository.snapshot.participants.some(p=>'/p/'+p.shareId===req.path)) || (req.path === setting<AdminConfig>('admin')?.path && isAdminIpAllowed(req.socket.remoteAddress))) { res.setHeader('Cache-Control','no-store'); res.sendFile(path.join(dist,'index.html')); }
    else res.status(404).send('Страница не найдена');
  });
}
app.use((error: any,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
  const status = error.name === 'ZodError' ? 400 : Number(error.status) || 500;
  const message = error.name === 'ZodError' ? error.issues.map((e:any) => e.path.join('.') + ': ' + e.message).join('; ') : status < 500 ? error.message : 'Операция не выполнена. Проверьте журнал сервера и обновите список.';
  res.status(status).json({error:message});
});
const onListen = () => console.log('SFMap: ' + config.origin + ' [SQLite]');
const server = config.tlsCert
  ? https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey), minVersion: 'TLSv1.2' }, app).listen(config.port,config.host,onListen)
  : app.listen(config.port,config.host,onListen);
// The public listener accepts only map resources; administrative routes stay on the main listener.
const shareApp = express();
shareApp.disable('x-powered-by');
shareApp.use((req,res) => {
  const publicPath = ['/', '/favicon.svg', '/api/health', '/api/participants'].includes(req.path) || /^\/(assets|geo|photos|map-cache)\//.test(req.path) || /^\/p\/[A-Za-z0-9_-]{8}$/.test(req.path) || /^\/api\/participants\/[A-Za-z0-9_-]{8}$/.test(req.path);
  if (!['GET','HEAD'].includes(req.method) || !publicPath) { res.status(404).send('Страница не найдена'); return; }
  app(req,res);
});
const shareServer = config.sharePort ? shareApp.listen(config.sharePort,config.shareHost,() => console.log('SFMap public map: http://' + config.shareHost + ':' + config.sharePort)) : null;
const servers = [server, ...(shareServer ? [shareServer] : [])];
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true; clearInterval(timer);clearInterval(cacheTimer);
  let remaining = servers.length;
  for (const listener of servers) listener.close(() => { if (--remaining === 0) { db.close(); process.exit(0); } });
};
for (const listener of servers) listener.on('error', error => { console.error('SFMap listener:', error.message); stop(); });
process.on('SIGINT',stop); process.on('SIGTERM',stop);
