/**
 * Contexto do módulo de Entregas e Devoluções.
 */

import { createContext, useContext } from 'react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { OpType } from '../../../shared/logistica/types';

export type LogRoute =
  | { page: 'painel'; status?: string; type?: string }
  | { page: 'nova'; type: OpType; contractId?: number }
  | { page: 'detalhe'; id: number }
  | { page: 'ocorrencias' }
  | { page: 'cadastros' }
  | { page: 'relatorios' };

export interface LogMeta {
  drivers: { id: number; name: string; document: string | null; phone: string | null; active: boolean }[];
  vehicles: { id: number; plate: string; description: string; capacity: string | null; active: boolean }[];
  users: { id: number; name: string; role: string }[];
  suppliers: { id: number; name: string }[];
  locations: { id: number; code: string; name: string }[];
  reports: Record<string, string>;
}

export interface LogCtx extends LogMeta {
  user: AuthUser;
  reload: () => void;
  navigate: (r: LogRoute) => void;
  openContract?: (contractNumber: string) => void;
  openOs?: (orderId: number) => void;
}

const Ctx = createContext<LogCtx | null>(null);
export const LogProvider = Ctx.Provider;
export function useLog() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLog fora do módulo de logística');
  return c;
}

export const toLocalInput = (iso?: string | null, plusHours = 0) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + plusHours * 3_600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const readFile = (file: File) =>
  new Promise<{ file_name: string; content: string }>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ file_name: file.name, content: String(r.result) });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
