/**
 * Contexto do módulo de Ordens de Serviço.
 */

import { createContext, useContext } from 'react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { OrderTypeRule, OsSettings } from '../../../shared/os/types';

export type OsTab = 'resumo' | 'tecnico' | 'materiais' | 'mao_de_obra' | 'checklist' | 'custos' | 'anexos' | 'historico';

export type OsRoute =
  | { page: 'painel'; status?: string }
  | { page: 'nova'; assetId?: number }
  | { page: 'detalhe'; id: number; tab?: OsTab }
  | { page: 'preventivas' }
  | { page: 'checklists' }
  | { page: 'relatorios' }
  | { page: 'config' };

export interface OsMeta {
  settings: OsSettings;
  types: OrderTypeRule[];
  users: { id: number; name: string; role: string }[];
  categories: string[];
  reports: Record<string, string>;
}

export interface OsCtx extends OsMeta {
  user: AuthUser;
  reload: () => void;
  route: OsRoute;
  navigate: (r: OsRoute) => void;
  openFinance?: (entryId: number) => void;
  openContract?: (contractNumber: string) => void;
}

const Ctx = createContext<OsCtx | null>(null);
export const OsProvider = Ctx.Provider;
export function useOs() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOs fora do módulo de OS');
  return c;
}

export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const typeLabel = (types: OrderTypeRule[], key: string) => types.find((t) => t.key === key)?.label || key;
export const fmtMinutes = (m: number | null | undefined) => (m === null || m === undefined ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`);
