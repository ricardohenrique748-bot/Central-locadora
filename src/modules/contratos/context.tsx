/**
 * Contexto do módulo de Contratos: usuário, configurações, usuários para seleção e navegação interna.
 */

import { createContext, useContext } from 'react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { ContractSettings } from '../../../shared/contratos/types';

export type CtrTab = 'resumo' | 'itens' | 'cronograma' | 'financeiro' | 'documentos' | 'movimentacoes' | 'historico';

export type CtrRoute =
  | { page: 'painel'; status?: string }
  | { page: 'novo' }
  | { page: 'orcamento' }
  | { page: 'editar'; id: number }
  | { page: 'detalhe'; id: number; tab?: CtrTab }
  | { page: 'alertas' }
  | { page: 'relatorios' }
  | { page: 'config' };

export interface CtrUser {
  id: number;
  name: string;
  role: string;
}

export interface CtrCtx {
  user: AuthUser;
  settings: ContractSettings;
  users: CtrUser[];
  reports: Record<string, string>;
  reload: () => void;
  route: CtrRoute;
  navigate: (r: CtrRoute) => void;
  /** Abre um título no Financeiro (ausente sem acesso). */
  openFinance?: (entryId: number) => void;
  /** Abre o cadastro de clientes (módulo próprio). */
  openCustomers?: () => void;
}

const Ctx = createContext<CtrCtx | null>(null);
export const CtrProvider = Ctx.Provider;
export function useCtr() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCtr fora do módulo de contratos');
  return c;
}

/** Chave única por envio (protege entregas/devoluções/cobranças contra clique duplo e reenvio). */
export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
