/**
 * Abas (módulos) que cada usuário pode acessar. O administrador define por usuário; sem definição
 * (null) o usuário vê as abas que o perfil já permite. Administrador sempre acessa tudo.
 */

import type { Role } from './orcamentos/types';

export type ModuleKey = 'orcamentos' | 'clientes' | 'contratos' | 'estoque' | 'operacao' | 'manutencao' | 'financeiro';

export const MODULE_LABELS: Record<ModuleKey, string> = {
  orcamentos: 'Orçamentos',
  clientes: 'Clientes',
  contratos: 'Contratos',
  estoque: 'Estoque',
  operacao: 'Operação (entregas e devoluções)',
  manutencao: 'Manutenção',
  financeiro: 'Financeiro',
};

export const MODULE_KEYS = Object.keys(MODULE_LABELS) as ModuleKey[];

type WithModules = { role: Role; modules?: ModuleKey[] | null };

export function hasModule(user: WithModules, m: ModuleKey): boolean {
  return user.role === 'admin' || !user.modules || user.modules.includes(m);
}

/** Orçamentos que o usuário enxerga: todos, só os de manutenção, só os comerciais (venda/locação) ou nenhum. */
export function quotationScope(user: WithModules): 'todos' | 'manutencao' | 'comercial' | 'nenhum' {
  const o = hasModule(user, 'orcamentos');
  const m = hasModule(user, 'manutencao');
  return o && m ? 'todos' : m ? 'manutencao' : o ? 'comercial' : 'nenhum';
}

/** Normaliza o que veio da tela: lista válida (sem repetição) ou null = sem restrição. */
export function normalizeModules(raw: unknown): ModuleKey[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((m): m is ModuleKey => MODULE_KEYS.includes(m as ModuleKey)))];
}
