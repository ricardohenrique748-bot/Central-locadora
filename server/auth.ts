/**
 * Autenticação: senha com scrypt, sessão por token aleatório em cookie httpOnly.
 * No banco fica apenas o SHA-256 do token (vazamento do banco não expõe sessões).
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DB } from './db';
import { AuthUser, Role } from '../shared/orcamentos/types';
import { normalizeModules } from '../shared/acesso';
import { HttpError } from './http';

export const SESSION_COOKIE = 'cl_session';
const REMEMBER_DAYS = 30;
const SESSION_HOURS = 12;

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}

export function validatePasswordStrength(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (password.length > 128) return 'Senha muito longa.';
  return null;
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
  password_hash: string;
  modules?: string | null;
}

export function toAuthUser(row: Omit<UserRow, 'password_hash'>): AuthUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role, active: !!row.active, modules: row.modules ? normalizeModules(JSON.parse(row.modules)) : null };
}

export function login(db: DB, email: string, password: string, remember: boolean) {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim()) as UserRow | undefined;
  // Mesmo custo com ou sem usuário: não revela quais e-mails existem
  const ok = row ? verifyPassword(String(password || ''), row.password_hash) : (hashPassword('x'), false);
  if (!row || !ok || !row.active) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  const ms = remember ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000;
  const expires = new Date(Date.now() + ms);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), row.id, expires.toISOString());
  return { token, user: toAuthUser(row), maxAge: remember ? ms : undefined };
}

export function logout(db: DB, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function userFromToken(db: DB, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.modules FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(sha256(token), new Date().toISOString()) as Omit<UserRow, 'password_hash'> | undefined;
  if (!row || !row.active) return null;
  return toAuthUser(row);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = userFromToken(db, req.cookies?.[SESSION_COOKIE]);
    if (!user) return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
    req.user = user;
    next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'Você não tem permissão para esta ação.'));
    next();
  };
}
