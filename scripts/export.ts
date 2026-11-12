import { db } from '../server/db.ts';
import { Repository } from '../server/repository.ts';
import { exportText } from '../server/export.ts';
try {
  const repository = new Repository(); await repository.initialize();
  const photos = db.prepare('SELECT participant_id,data,version FROM photos').all() as {participant_id:string;data:Uint8Array;version:string}[];
  process.stdout.write(exportText(repository.snapshot.participants,photos));
} finally { db.close(); }
