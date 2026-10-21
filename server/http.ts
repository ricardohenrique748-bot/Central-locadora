/**
 * Erros HTTP padronizados: { error, fields? } com status apropriado.
 */

import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new HttpError(400, msg, fields);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new HttpError(403, msg);
export const notFound = (msg = 'Registro não encontrado.') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Conteúdo muito grande.' });
    return;
  }
  const msg = String(err?.message || '');
  if (msg.includes('UNIQUE constraint failed')) {
    res.status(409).json({ error: 'Registro duplicado.' });
    return;
  }
  if (msg.includes('CHECK constraint failed') || msg.includes('FOREIGN KEY constraint failed')) {
    res.status(400).json({ error: 'Dados inválidos ou inconsistentes.' });
    return;
  }
  console.error('[api] erro inesperado:', err);
  res.status(500).json({ error: 'Erro interno no servidor. Tente novamente.' });
}

export function parseId(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Identificador inválido.');
  return n;
}
