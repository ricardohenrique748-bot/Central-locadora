/**
 * Permissões por perfil. Usadas no servidor (autoridade) e na interface (apenas para exibir botões).
 *
 * - Administrador: tudo; aprova até o limite de desconto configurado para admin.
 * - Gestor: vê todos os orçamentos, edita, aprova dentro da sua alçada, gerencia catálogo.
 * - Vendedor: cria; vê e altera apenas os próprios orçamentos; aprova internamente só os
 *   próprios e só dentro da sua alçada, quando a aprovação interna obrigatória está desligada.
 * - Consulta: somente leitura.
 */

import { AuthUser, ModuleSettings, QuotationAction, QuotationStatus } from './types';
import { quotationScope } from '../acesso';
import { canTransition } from './status';

export interface QuotationAccessInfo {
  responsible_user_id: number;
  status: QuotationStatus;
  effective_discount_percent: number;
}

/** Perfis que operam orçamentos; estoquista e consulta só leem. */
const COMMERCIAL: AuthUser['role'][] = ['admin', 'gestor', 'vendedor'];
const isCommercial = (user: AuthUser) => COMMERCIAL.includes(user.role);

export function canViewQuotation(user: AuthUser, q: { responsible_user_id: number; category?: string | null }): boolean {
  // aba liberada: só Manutenção → só orçamentos de manutenção; só Orçamentos → só venda/locação
  const scope = quotationScope(user);
  if (scope === 'nenhum' || (scope === 'manutencao' && q.category !== 'manutencao') || (scope === 'comercial' && q.category === 'manutencao')) return false;
  return user.role !== 'vendedor' || q.responsible_user_id === user.id;
}

export function canCreateQuotation(user: AuthUser): boolean {
  return isCommercial(user);
}

export function canManageCustomers(user: AuthUser): boolean {
  return isCommercial(user);
}

export function canInactivateCustomers(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'gestor';
}

export function canManageCatalog(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'gestor';
}

export function canManageSettings(user: AuthUser): boolean {
  return user.role === 'admin';
}

export function canChangePrice(user: AuthUser, settings: ModuleSettings): boolean {
  if (user.role === 'admin' || user.role === 'gestor') return true;
  return user.role === 'vendedor' && settings.seller_can_change_price;
}

export function discountLimit(user: AuthUser, settings: ModuleSettings): number {
  return settings.discount_limits[user.role] ?? 0;
}

/** O usuário pode aprovar internamente este orçamento (alçada de desconto)? */
export function canApproveInternally(user: AuthUser, q: QuotationAccessInfo, settings: ModuleSettings): boolean {
  if (!isCommercial(user)) return false;
  const withinLimit = q.effective_discount_percent <= discountLimit(user, settings) + 1e-9;
  if (user.role === 'admin' || user.role === 'gestor') return withinLimit;
  // vendedor
  if (settings.require_internal_approval) return false;
  if (q.status === 'aguardando_aprovacao') return false;
  return q.responsible_user_id === user.id && withinLimit;
}

/** Ação permitida pelo status E pelo perfil (integrações externas são checadas à parte). */
export function canPerform(user: AuthUser, action: QuotationAction, q: QuotationAccessInfo, settings: ModuleSettings): boolean {
  if (!isCommercial(user)) return false;
  if (!canTransition(action, q.status)) return false;
  const owner = q.responsible_user_id === user.id;
  const manager = user.role === 'admin' || user.role === 'gestor';

  switch (action) {
    case 'duplicar':
      return true;
    case 'aprovar_interno':
      return canApproveInternally(user, q, settings);
    case 'solicitar_aprovacao':
      return (manager || owner) && !canApproveInternally(user, q, settings);
    case 'rejeitar_aprovacao':
      return manager;
    default:
      return manager || owner;
  }
}

export function allowedActions(user: AuthUser, q: QuotationAccessInfo, settings: ModuleSettings): QuotationAction[] {
  const all: QuotationAction[] = [
    'editar', 'enviar_revisao', 'aprovar_interno', 'solicitar_aprovacao', 'rejeitar_aprovacao',
    'registrar_envio', 'registrar_negociacao', 'aprovar_cliente', 'recusar', 'renovar',
    'nova_versao', 'converter', 'duplicar', 'cancelar',
  ];
  return all.filter((a) => canPerform(user, a, q, settings));
}
