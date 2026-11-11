import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.ts';
import { db, setting, audit } from './db.ts';
import { authenticate, createChallenge, requireAdmin, requireCsrf, hashToken, type AdminConfig } from './auth.ts';
import { Repository } from './repository.ts';
import { avatarFor, avatarState, refreshAvatars } from './avatars.ts';
import { participantSchema, type PublicParticipant } from '../shared/participant.ts';
import { requireRegion } from './geography.ts';
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:', 'https://tiles.openfreemap.org'],
  connectSrc: ["'self'", 'https://tiles.openfreemap.org'], workerSrc: ["'self'", 'blob:'],
  fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.secure ? [] : null,
} }, strictTransportSecurity: config.secure ? undefined : false }));
app.use(express.json({ limit: '32kb' })); app.use(cookieParser());
app.use('/api', (_req,res,next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', rateLimit({ windowMs:60000, limit:180, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Слишком много запросов. Подождите минуту.'} }));
const loginLimit = rateLimit({ windowMs:15*60*1000, limit:15, standardHeaders:'draft-8', legacyHeaders:false, message:{error:'Слишком много попыток входа. Повторите через 15 минут.'} });
const repository = new Repository();
await repository.initialize();
const sync = async () => { try { await repository.refresh(); void refreshAvatars(repository.snapshot.participants).catch(() => {}); } catch { /* Keep last confirmed snapshot. */ } };
const timer = setInterval(() => void sync(), 60000); timer.unref();
void refreshAvatars(repository.snapshot.participants).catch(() => {});
app.get('/api/health', (_req,res) => res.json({ ok:true, source:'sqlite' }));
app.get('/api/participants', (_req,res) => {
  const participants: PublicParticipant[] = repository.snapshot.participants.map(p => ({
    id:p.id, name:p.name, locationId:p.locationId, city:p.city, plate:p.plate, color:p.color, year:p.year, generation:p.generation,
    engine:p.engine, transmission:p.transmission, aspiration:p.aspiration, steering:p.steering,
    comment:p.comment, latitude:p.latitude, longitude:p.longitude, updatedAt:p.updatedAt, avatar:avatarFor(p.telegram),
  }));
  res.json({ participants, source:'sqlite', stale:!!repository.lastError, syncedAt:repository.snapshot.syncedAt });
});
const checkAccess: express.RequestHandler = (req,res,next) => {
  const admin = setting<AdminConfig>('admin');
  if (!admin || req.body?.path !== admin.path || req.headers.origin !== config.origin) { res.status(404).json({error:'Адрес не найден'}); return; } next();
};
app.post('/api/admin/challenge', loginLimit, checkAccess, (_req,res) => res.json(createChallenge()));
app.post('/api/admin/login', loginLimit, checkAccess, async (req,res) => res.json(await authenticate(req.body,res)));
app.use('/api/admin', requireAdmin);
app.get('/api/admin/session', (_req,res) => res.json({ csrf:res.locals.session.csrf, source:'sqlite' }));
const adminSnapshot = () => ({ ...repository.snapshot, participants:repository.snapshot.participants.map(p => ({ ...p, avatar:avatarFor(p.telegram), avatarState:avatarState(p.telegram) })), source:'sqlite', error:repository.lastError });
app.get('/api/admin/participants', (_req,res) => res.json(adminSnapshot()));
app.post('/api/admin/refresh', requireCsrf, async (_req,res) => { await sync(); res.status(repository.lastError ? 503 : 200).json(adminSnapshot()); });
app.post('/api/admin/logout', requireCsrf, (req,res) => { db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(req.cookies.sfmap_session)); res.clearCookie('sfmap_session',{path:'/api/admin'}); audit('logout'); res.json({ok:true}); });
app.get('/api/admin/audit', (_req,res) => res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()));
app.post('/api/admin/participants/:id/avatar/refresh', requireCsrf, (req,res) => {
  const participant = repository.snapshot.participants.find(p => p.id === req.params.id);
  if (!participant) { res.status(404).json({error:'Участник не найден'}); return; }
  void refreshAvatars([participant], {force:true}).catch(() => {});
  res.status(202).json({avatarState:avatarState(participant.telegram)});
});
app.post('/api/admin/participants', requireCsrf, async (req,res) => {
  const input = participantSchema.parse(req.body); requireRegion(input.latitude,input.longitude);
  const participant = await repository.mutate('create',input); audit('participant_created',participant?.id);
  if (participant) void refreshAvatars([participant], {force:true}).catch(() => {});
  res.status(201).json(participant && { ...participant, avatar:avatarFor(participant.telegram) });
});
app.put('/api/admin/participants/:id', requireCsrf, async (req,res) => {
  const input = participantSchema.parse(req.body); requireRegion(input.latitude,input.longitude);
  const participant = await repository.mutate('update',input,String(req.params.id),req.body.revision); audit('participant_updated',String(req.params.id));
  if (participant) void refreshAvatars([participant], {force:true}).catch(() => {});
  res.json(participant && { ...participant, avatar:avatarFor(participant.telegram) });
});
app.delete('/api/admin/participants/:id', requireCsrf, async (req,res) => { await repository.mutate('delete',undefined,String(req.params.id),req.body.revision); audit('participant_deleted',String(req.params.id)); res.json({ok:true}); });
app.use('/api', (_req,res) => res.status(404).json({error:'Адрес не найден'}));
app.use('/avatars', (req,res,next) => {
  if (!/^\/[a-f0-9]{32}\.webp$/.test(req.path)) { res.sendStatus(404); return; }
  next();
}, express.static(path.join(config.dataDir,'avatars'), { maxAge:'1h', dotfiles:'deny', fallthrough:false }));
const dist = path.resolve('dist');
if (fs.existsSync(path.join(dist,'index.html'))) {
  app.use(express.static(dist,{index:false,maxAge:'1h'}));
  app.get('/{*path}', (req,res) => {
    if (req.path === '/' || req.path === setting<AdminConfig>('admin')?.path) { res.setHeader('Cache-Control','no-store'); res.sendFile(path.join(dist,'index.html')); }
    else res.status(404).send('Страница не найдена');
  });
}
app.use((error: any,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
  const status = error.name === 'ZodError' ? 400 : Number(error.status) || 500;
  const message = error.name === 'ZodError' ? error.issues.map((e:any) => e.path.join('.') + ': ' + e.message).join('; ') : status < 500 ? error.message : 'Операция не выполнена. Проверьте журнал сервера и обновите список.';
  res.status(status).json({error:message});
});
const server = app.listen(config.port,config.host,() => console.log('SFMap: ' + config.origin + ' [SQLite]'));
// The public listener accepts only map resources; administrative routes stay on the main listener.
const shareApp = express();
shareApp.disable('x-powered-by');
shareApp.use((req,res) => {
  const publicPath = ['/', '/favicon.svg', '/api/health', '/api/participants'].includes(req.path) || /^\/(assets|geo|avatars)\//.test(req.path);
  if (!['GET','HEAD'].includes(req.method) || !publicPath) { res.status(404).send('Страница не найдена'); return; }
  app(req,res);
});
const shareServer = config.sharePort ? shareApp.listen(config.sharePort,config.shareHost,() => console.log('SFMap public map: http://' + config.shareHost + ':' + config.sharePort)) : null;
const servers = [server, ...(shareServer ? [shareServer] : [])];
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true; clearInterval(timer);
  let remaining = servers.length;
  for (const listener of servers) listener.close(() => { if (--remaining === 0) { db.close(); process.exit(0); } });
};
for (const listener of servers) listener.on('error', error => { console.error('SFMap listener:', error.message); stop(); });
process.on('SIGINT',stop); process.on('SIGTERM',stop);
