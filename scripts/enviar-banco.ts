/**
 * Envia o banco local (data/central.db) para o Supabase, substituindo o que estiver lá.
 * Uso: npm run db:enviar   (lê DATABASE_URL do .env)
 */

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, ensureSchema, lock, writeSnapshot } from '../server/cloudStore';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Defina DATABASE_URL no arquivo .env.');
const source = process.env.DB_FILE || path.resolve('data', 'central.db');

// cópia compacta e consistente, sem arquivos -wal/-shm
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'central-')), 'central.db');
const local = new DatabaseSync(source);
local.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
local.close();
const copy = new DatabaseSync(tmp);
copy.exec('PRAGMA journal_mode = DELETE');
copy.close();

const pool = createPool(databaseUrl, 1);
const client = await pool.connect();
try {
  await ensureSchema(client);
  await lock(client);
  const version = await writeSnapshot(client, fs.readFileSync(tmp));
  await client.query('COMMIT');
  console.log(`Banco enviado ao Supabase (versão ${version}, ${Math.round(fs.statSync(tmp).size / 1024)} KB).`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
