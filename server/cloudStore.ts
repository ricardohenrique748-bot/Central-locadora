/**
 * Banco guardado no Supabase (Postgres) para ambientes sem disco persistente, como a Vercel.
 * O SQLite continua sendo o motor das consultas, num arquivo temporário; o arquivo inteiro (gzip)
 * fica em central.app_db_snapshot. Cada requisição roda sob advisory lock: recarrega o arquivo se outra
 * instância gravou uma versão mais nova e, havendo alterações, grava a nova versão antes de responder.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';
import type { RequestHandler } from 'express';
import { DB, migrate } from './db';

const LOCK_KEY = 7_420_101;

export function createPool(databaseUrl: string, max = 2) {
  return new pg.Pool({ connectionString: databaseUrl, max, ssl: { rejectUnauthorized: false } });
}

/** Schema fora do "public" (não exposto pela API REST do Supabase) e com RLS: só o dono (postgres) acessa. */
export async function ensureSchema(client: pg.PoolClient) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS central;
    CREATE TABLE IF NOT EXISTS central.app_db_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version BIGINT NOT NULL,
      data BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE central.app_db_snapshot ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON SCHEMA central FROM PUBLIC;
  `);
}

/** Abre transação e espera a vez (uma requisição por vez em todas as instâncias). */
export async function lock(client: pg.PoolClient) {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
}

export async function writeSnapshot(client: pg.PoolClient, file: Buffer): Promise<number> {
  const r = await client.query(
    `INSERT INTO central.app_db_snapshot (id, version, data) VALUES (1, 1, $1)
     ON CONFLICT (id) DO UPDATE SET version = central.app_db_snapshot.version + 1, data = EXCLUDED.data, updated_at = now()
     RETURNING version`,
    [zlib.gzipSync(file)]
  );
  return Number(r.rows[0].version);
}

export function createCloudStore(opts: { databaseUrl: string; file: string; init: (db: DB) => void; afterRequest?: (db: DB) => void }) {
  const pool = createPool(opts.databaseUrl);
  let inner: DatabaseSync | null = null;
  let version = -1; // -1: cópia local inválida, recarregar na próxima requisição
  let schemaReady = false;

  // os módulos recebem este objeto uma única vez; a conexão real é trocada a cada recarga
  const db = new Proxy({} as DB, {
    get(_t, prop) {
      if (!inner) throw new Error('Banco ainda não carregado.');
      const v = (inner as any)[prop];
      return typeof v === 'function' ? v.bind(inner) : v;
    },
  });

  const invalidate = () => {
    version = -1;
    schemaReady = false;
  };
  const totalChanges = () => (inner!.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

  function open(bytes: Buffer | null) {
    inner?.close();
    inner = null;
    for (const f of [opts.file, `${opts.file}-journal`, `${opts.file}-wal`, `${opts.file}-shm`]) fs.rmSync(f, { force: true });
    fs.mkdirSync(path.dirname(opts.file), { recursive: true });
    if (bytes) fs.writeFileSync(opts.file, bytes);
    inner = new DatabaseSync(opts.file);
    // sem WAL: cada COMMIT fica inteiro no arquivo principal, que é o que se grava no Supabase
    inner.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;');
    migrate(db);
    opts.init(db);
  }

  /** Garante a cópia local na versão mais recente; retorna true se ela já nasce com alterações a gravar. */
  async function sync(client: pg.PoolClient): Promise<boolean> {
    if (!schemaReady) {
      await ensureSchema(client);
      schemaReady = true;
    }
    const head = await client.query('SELECT version FROM central.app_db_snapshot WHERE id = 1');
    if (!head.rows.length) {
      open(null);
      version = 0;
      return true;
    }
    if (inner && Number(head.rows[0].version) === version) return false;
    const r = await client.query('SELECT version, data FROM central.app_db_snapshot WHERE id = 1');
    open(zlib.gunzipSync(r.rows[0].data));
    version = Number(r.rows[0].version);
    return totalChanges() > 0; // migração ou carga inicial nova aplicada nesta recarga
  }

  const middleware: RequestHandler = async (_req, res, next) => {
    let client: pg.PoolClient;
    try {
      client = await pool.connect();
    } catch (e) {
      return next(e);
    }
    let released = false;
    const finish = async (commit: boolean) => {
      if (released) return;
      released = true;
      try {
        await client.query(commit ? 'COMMIT' : 'ROLLBACK');
        client.release();
      } catch (e) {
        client.release(e as Error);
      }
    };

    try {
      await lock(client);
      const dirty = await sync(client);
      const base = totalChanges();

      // a resposta só sai depois de gravada no Supabase (inclusive erros 4xx: o que já foi gravado no SQLite fica)
      const end = res.end.bind(res) as (...a: any[]) => typeof res;
      res.end = ((...args: any[]) => {
        void (async () => {
          try {
            opts.afterRequest?.(db);
            if (dirty || totalChanges() !== base) version = await writeSnapshot(client, fs.readFileSync(opts.file));
            await finish(true);
          } catch (e) {
            invalidate();
            await finish(false);
            console.error('[cloudStore] falha ao gravar o banco:', e);
            if (!res.headersSent) {
              res.statusCode = 503;
              res.removeHeader('Content-Length');
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              end(JSON.stringify({ error: 'Não foi possível salvar os dados. Tente novamente.' }));
              return;
            }
          }
          end(...args);
        })();
        return res;
      }) as typeof res.end;
      res.on('close', () => {
        if (released) return;
        invalidate(); // conexão caiu antes do fim: libera a trava e descarta a cópia local
        void finish(false);
      });
      next();
    } catch (e) {
      invalidate();
      await finish(false);
      next(e);
    }
  };

  return { db, middleware };
}
