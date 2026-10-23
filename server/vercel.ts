/**
 * Função serverless da Vercel: a mesma API do server.ts, com o banco guardado no Supabase (cloudStore).
 * Empacotada por scripts/build-vercel.mjs.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { createCloudStore } from './cloudStore';
import { seedAll } from './seed';
import { runPendingProcessing, useInlineProcessing } from './services/notifications/engine';

let app: ReturnType<typeof createApp> | null = null;

// criada na primeira requisição: uma falha de configuração vira resposta legível em vez de queda da função
function getApp() {
  if (app) return app;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não configurada nas variáveis de ambiente da Vercel (configure e faça Redeploy).');
  useInlineProcessing();
  const store = createCloudStore({ databaseUrl, file: '/tmp/central.db', init: seedAll, afterRequest: runPendingProcessing });
  app = createApp(store.db, { trustProxy: true, before: store.middleware });
  return app;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // a rota /api/(.*) chega como /api?__path=...; restaura o caminho original para o Express
  const url = new URL(req.url || '/', 'http://localhost');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${original}${url.search}`;
  }
  try {
    getApp()(req as any, res as any);
  } catch (e) {
    console.error('[vercel] falha ao iniciar a API:', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `Falha ao iniciar o servidor: ${(e as Error).message}` }));
  }
}
