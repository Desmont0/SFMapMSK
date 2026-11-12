import { db } from '../server/db.ts';
const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
console.log('SFMap SQLite schema ready (version ' + version + ').');
db.close();
