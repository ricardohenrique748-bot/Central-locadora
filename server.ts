/**
 * Central Locação - Servidor da aplicação.
 * Express serve a API (/api) e, em desenvolvimento, o Vite em modo middleware — um único `npm run dev`.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { openDatabase } from './server/db';
import { seedIfEmpty, seedStockIfEmpty } from './server/seed';
import { seedFinanceIfEmpty } from './server/services/finance/registry';
import { seedOsIfEmpty } from './server/services/os/core';
import { startNotificationScheduler } from './server/services/notifications/engine';
import { createApi } from './server/api';
import { errorHandler } from './server/http';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const DB_FILE = process.env.DB_FILE || path.resolve('data', 'central.db');

async function main() {
  const db = openDatabase(DB_FILE);
  seedIfEmpty(db);
  seedStockIfEmpty(db);
  seedFinanceIfEmpty(db);
  seedOsIfEmpty(db);
  startNotificationScheduler(db); // verificação recorrente de prazos e vencimentos, com log

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use('/api', createApi(db), errorHandler);

  if (isProd) {
    const dist = path.resolve('dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Central Locação rodando em http://localhost:${PORT}  (banco: ${DB_FILE})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
