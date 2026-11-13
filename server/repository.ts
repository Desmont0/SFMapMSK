import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { db } from './db.ts';
import { participantSchema, storedParticipant, type Participant, type ParticipantInput } from '../shared/participant.ts';
import { requireRegion } from './geography.ts';

export type RowError = { row: number; message: string };
export type Snapshot = { participants: Participant[]; errors: RowError[]; syncedAt: string | null };
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }); };

type ParticipantRow = { id: string; share_id: string; data: string; updated_at: string; revision: string };

function decode(row: ParticipantRow): Participant {
  return { ...storedParticipant(JSON.parse(row.data)), id: row.id, shareId: row.share_id, updatedAt: row.updated_at, revision: row.revision };
}

export class Repository {
  snapshot: Snapshot = { participants: [], errors: [], syncedAt: null };
  lastError: string | null = null;

  async initialize() { await this.refresh(); }

  async refresh() {
    try {
      const rows = db.prepare('SELECT p.id,l.share_id,p.data,p.updated_at,p.revision FROM participants p LEFT JOIN participant_links l ON l.participant_id=p.id ORDER BY p.rowid').all() as ParticipantRow[];
      this.snapshot = { participants: rows.map(decode), errors: [], syncedAt: new Date().toISOString() };
      this.lastError = null;
      return this.snapshot;
    } catch (error) {
      this.lastError = 'Не удалось прочитать базу данных. Проверьте журнал сервера и доступ к диску.';
      throw error;
    }
  }

  async mutate(action: 'create' | 'update' | 'delete', input?: ParticipantInput, id?: string, expected?: string) {
    let result: Participant | null = null;
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = id ? db.prepare('SELECT p.id,l.share_id,p.data,p.updated_at,p.revision FROM participants p LEFT JOIN participant_links l ON l.participant_id=p.id WHERE p.id=?').get(id) as ParticipantRow | undefined : undefined;
      if (action !== 'create' && !row) fail('Запись больше не существует. Обновите список.');
      if (action !== 'create' && row!.revision !== expected) fail('Запись уже изменена в другой вкладке. Обновите список.');
      if (action === 'delete') {
        if (db.prepare("SELECT 1 FROM participants WHERE json_extract(data,'$.ownerId')=? LIMIT 1").get(id!)) fail('Сначала уберите этого владельца из связанных гаражей.');
        db.prepare('DELETE FROM photos WHERE participant_id=?').run(id!);
        db.prepare('DELETE FROM participant_links WHERE participant_id=?').run(id!);
        db.prepare('DELETE FROM participants WHERE id=?').run(id!);
      } else {
        if (action === 'create' && (db.prepare('SELECT count(*) AS count FROM participants').get() as any).count >= 1000) fail('Достигнут лимит 1000 участников.', 400);
        const data = participantSchema.parse(input);
        if (data.ownerId) {
          if (data.ownerId === id) fail('Гараж не может быть своим владельцем. Выберите участника.',400);
          const owner = db.prepare('SELECT data FROM participants WHERE id=?').get(data.ownerId) as {data:string}|undefined;
          if (!owner || (JSON.parse(owner.data).kind || 'person') !== 'person') fail('Выберите владельца из списка участников.',400);
        }
        if (data.kind !== 'person' && id && db.prepare("SELECT 1 FROM participants WHERE json_extract(data,'$.ownerId')=? LIMIT 1").get(id)) fail('Сначала уберите этого владельца из связанных гаражей.');
        requireRegion(data.latitude, data.longitude);
        const participantId = action === 'create' ? randomUUID() : row!.id;
        let shareId = row?.share_id || '';
        if (action === 'create') do { shareId = randomBytes(6).toString('base64url'); } while (db.prepare('SELECT 1 FROM participant_links WHERE share_id=?').get(shareId));
        const previousTime = row ? Date.parse(row.updated_at) : 0;
        const updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
        const revision = createHash('sha256').update(JSON.stringify({ ...data, id: participantId, updatedAt })).digest('hex');
        if (action === 'create') {
          db.prepare('INSERT INTO participants(id,data,updated_at,revision) VALUES(?,?,?,?)').run(participantId, JSON.stringify(data), updatedAt, revision);
          db.prepare('INSERT INTO participant_links(participant_id,share_id) VALUES(?,?)').run(participantId, shareId);
        }
        else db.prepare('UPDATE participants SET data=?,updated_at=?,revision=? WHERE id=?').run(JSON.stringify(data), updatedAt, revision, participantId);
        result = { ...data, id: participantId, shareId, updatedAt, revision };
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    await this.refresh();
    return result;
  }
}
