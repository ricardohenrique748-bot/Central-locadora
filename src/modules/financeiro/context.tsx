/**
 * Contexto do módulo Financeiro: usuário, cadastros de apoio e navegação interna.
 */

import { createContext, useContext } from 'react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { CostCenter, FinanceSettings, FinancialAccount, FinancialCategory } from '../../../shared/financeiro/types';

export type FinRoute =
  | { page: 'dashboard' }
  | { page: 'pagar'; status?: string }
  | { page: 'receber'; status?: string }
  | { page: 'novo'; type: 'pagar' | 'receber'; stockEntryId?: number }
  | { page: 'editar'; id: number }
  | { page: 'titulo'; id: number }
  | { page: 'fluxo' }
  | { page: 'contas' }
  | { page: 'lancamentos'; accountId?: number }
  | { page: 'transferencias' }
  | { page: 'categorias' }
  | { page: 'centros' }
  | { page: 'conciliacao' }
  | { page: 'inadimplencia' }
  | { page: 'faturas' }
  | { page: 'relatorios' }
  | { page: 'config' };

export interface FinCtx {
  user: AuthUser;
  accounts: FinancialAccount[];
  categories: FinancialCategory[];
  costCenters: CostCenter[];
  settings: FinanceSettings;
  reload: () => void;
  route: FinRoute;
  navigate: (r: FinRoute) => void;
}

const Ctx = createContext<FinCtx | null>(null);
export const FinProvider = Ctx.Provider;
export function useFin() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFin fora do módulo financeiro');
  return c;
}

/** Chave única por envio de formulário (protege contra clique duplo / reenvio). */
export const newIdempotencyKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
