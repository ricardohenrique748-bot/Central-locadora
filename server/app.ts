/**
 * Aplicação Express da API, compartilhada pelo servidor local (server.ts) e pela função da Vercel (server/vercel.ts).
 */

import express, { RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { DB } from './db';
import { createApi } from './api';
import { errorHandler } from './http';

export function createApp(db: DB, opts: { trustProxy?: boolean | string; before?: RequestHandler } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? 'loopback');
  if (opts.before) app.use('/api', opts.before);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use('/api', createApi(db), errorHandler);
  return app;
}
