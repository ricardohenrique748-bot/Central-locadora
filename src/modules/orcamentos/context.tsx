/**
 * Contexto do módulo: usuário autenticado, configurações e navegação interna.
 */

import React, { createContext, useContext } from 'react';
import { AuthUser, ModuleSettings } from '../../../shared/orcamentos/types';

export type Route =
  | { page: 'painel' }
  | { page: 'novo'; modo?: 'manutencao' }
  | { page: 'lista'; status?: string; /** filtros vindos de um card do painel */ filters?: Record<string, string>; /** nome da seleção de status do card */ label?: string }
  | { page: 'detalhe'; id: number }
  | { page: 'editar'; id: number }
  | { page: 'clientes'; novo?: number }
  | { page: 'relatorios' }
  | { page: 'config' };

export interface Integrations {
  venda: boolean;
  contrato_locacao: boolean;
  estoque: boolean;
  financeiro: boolean;
}

export interface ModuleCtx {
  user: AuthUser;
  settings: ModuleSettings;
  integrations: Integrations;
  reloadSettings: () => void;
  route: Route;
  navigate: (r: Route) => void;
  /** Abre um título no módulo Financeiro (ausente quando o usuário não tem acesso). */
  openFinance?: (entryId: number) => void;
  /** Abre o contrato gerado pela conversão (ausente sem acesso). */
  openContract?: (contractNumber: string) => void;
}

export const ModuleContext = createContext<ModuleCtx | null>(null);

export function useModule() {
  const ctx = useContext(ModuleContext);
  if (!ctx) throw new Error('useModule fora do módulo de orçamentos');
  return ctx;
}

export type UserOption = { id: number; name: string; role: string };
export const ModuleProvider = ModuleContext.Provider;
export type { React };
