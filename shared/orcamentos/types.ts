/**
 * Central Locação - Módulo de Orçamentos: tipos compartilhados entre servidor e interface.
 * Valores monetários sempre em CENTAVOS inteiros (ex.: R$ 12,34 = 1234).
 */

export type Role = 'admin' | 'gestor' | 'vendedor' | 'estoquista' | 'financeiro' | 'tecnico' | 'consulta';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  vendedor: 'Vendedor',
  estoquista: 'Estoquista',
  financeiro: 'Financeiro',
  tecnico: 'Técnico de manutenção',
  consulta: 'Consulta',
};

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** abas liberadas pelo administrador; null/ausente = as do perfil */
  modules?: import('../acesso').ModuleKey[] | null;
}

export type PersonType = 'PF' | 'PJ';

export interface Customer {
  id: number;
  person_type: PersonType;
  name: string;
  trade_name: string | null;
  document: string | null; // apenas dígitos
  state_registration: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  postal_code: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type CustomerInput = Omit<Customer, 'id' | 'created_at' | 'updated_at'>;

export type ItemType = 'equipamento' | 'produto' | 'peca' | 'acessorio';

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  equipamento: 'Equipamento',
  produto: 'Produto',
  peca: 'Peça',
  acessorio: 'Acessório',
};

export interface CatalogItem {
  id: number;
  internal_code: string;
  description: string;
  category: string | null;
  item_type: ItemType;
  sale_enabled: boolean;
  rental_enabled: boolean;
  brand: string | null;
  model: string | null;
  unit: string;
  sale_price: number | null;
  daily_rental_price: number | null;
  weekly_rental_price: number | null;
  monthly_rental_price: number | null;
  custom_rental_price: number | null;
  technical_description: string | null;
  image_data: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type CatalogItemInput = Omit<CatalogItem, 'id' | 'created_at' | 'updated_at'>;

export type QuotationType = 'venda' | 'locacao';

/** Categoria do orçamento de venda: comercial (produtos) ou manutenção de equipamento do cliente (peças + serviços). */
export type QuotationCategory = 'comercial' | 'manutencao';

/** Equipamento do cliente num orçamento de manutenção. */
export interface EquipmentInfo {
  description: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  reported_defect: string | null;
  diagnosis: string | null;
}

/** Rótulo da modalidade exibido nas telas e no PDF (manutenção é uma venda de serviço). */
export const modalityLabel = (q: { quotation_type: QuotationType; category?: QuotationCategory | null }) =>
  q.category === 'manutencao' ? 'Manutenção' : QUOTATION_TYPE_LABELS[q.quotation_type];

export const QUOTATION_TYPE_LABELS: Record<QuotationType, string> = {
  venda: 'Venda',
  locacao: 'Locação',
};

export type BillingPeriod = 'diaria' | 'semanal' | 'mensal' | 'personalizado';

export const BILLING_PERIOD_LABELS: Record<BillingPeriod, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  mensal: 'Mensal',
  personalizado: 'Personalizado',
};

export type DiscountType = 'percent' | 'fixed';

export type QuotationStatus =
  | 'rascunho'
  | 'em_revisao'
  | 'aguardando_aprovacao'
  | 'aprovado_interno'
  | 'enviado'
  | 'em_negociacao'
  | 'aprovado_cliente'
  | 'recusado'
  | 'expirado'
  | 'cancelado'
  | 'convertido';

export type AvailabilityStatus = 'nao_verificada' | 'confirmada' | 'insuficiente' | 'indisponivel';

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  nao_verificada: 'Disponibilidade não verificada',
  confirmada: 'Disponibilidade confirmada',
  insuficiente: 'Disponibilidade insuficiente',
  indisponivel: 'Equipamento indisponível',
};

/** Item enviado pela interface ao salvar. Totais são recalculados no servidor. */
export interface QuotationItemInput {
  catalog_item_id: number | null;
  item_code_snapshot: string;
  description_snapshot: string;
  item_type_snapshot: ItemType;
  unit: string;
  quantity: number;
  unit_price: number; // centavos por unidade (venda) ou por período (locação)
  reference_price: number | null; // preço de catálogo no momento da inclusão
  billing_period: BillingPeriod | null;
  discount_type: DiscountType;
  discount_value: number; // percentual (0-100, até 2 casas) ou centavos
  notes: string | null;
}

export interface QuotationItem extends QuotationItemInput {
  id: number;
  position: number;
  periods: number;
  gross_total: number;
  discount_amount: number;
  line_total: number;
}

export interface CustomerSnapshot {
  id: number;
  person_type: PersonType;
  name: string;
  trade_name: string | null;
  document: string | null;
  state_registration: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string;
}

/** Campos editáveis do orçamento (cabeçalho + condições). */
export interface QuotationInput {
  customer_id: number;
  quotation_type: QuotationType;
  category: QuotationCategory;
  equipment_info: EquipmentInfo | null;
  expiration_date: string; // YYYY-MM-DD
  client_reference: string | null;
  // Locação
  start_date: string | null;
  end_date: string | null;
  rental_billing_period: BillingPeriod | null;
  custom_periods: number | null; // nº de períodos quando "personalizado"
  custom_period_label: string | null; // ex.: "Quinzena"
  availability_status: AvailabilityStatus;
  // Condições
  general_discount_type: DiscountType;
  general_discount_value: number;
  additional_charges: number;
  freight_amount: number; // venda: frete; locação: frete de entrega
  pickup_freight_amount: number; // locação: frete de retirada
  installation_amount: number;
  other_services_amount: number;
  deposit_amount: number; // caução — nunca somada ao total
  payment_terms: string | null;
  delivery_terms: string | null;
  warranty_terms: string | null;
  pickup_delivery_terms: string | null;
  customer_responsibilities: string | null;
  return_conditions: string | null;
  included_accessories: string | null;
  complementary_description: string | null;
  specific_conditions: string | null;
  commercial_notes: string | null;
  internal_notes: string | null;
  items: QuotationItemInput[];
}

export interface QuotationTotals {
  reference_total: number;
  items_gross_total: number;
  item_discount_total: number;
  price_reduction_total: number;
  subtotal: number;
  general_discount: number;
  additional_charges: number;
  freight_amount: number;
  pickup_freight_amount: number;
  installation_amount: number;
  other_services_amount: number;
  total_amount: number;
  deposit_amount: number;
  effective_discount_percent: number;
}

export interface Quotation extends Omit<QuotationInput, 'items'>, QuotationTotals {
  id: number;
  quotation_number: string;
  status: QuotationStatus;
  responsible_user_id: number;
  responsible_name: string;
  customer_snapshot: CustomerSnapshot;
  rental_days: number | null;
  version: number;
  row_version: number;
  sent_at: string | null;
  refusal_reason: string | null;
  converted_record_type: string | null;
  converted_record_id: string | null;
  issue_date: string;
  created_at: string;
  updated_at: string;
  items: QuotationItem[];
}

export interface QuotationListRow {
  id: number;
  quotation_number: string;
  created_at: string;
  updated_at: string;
  customer_id: number;
  customer_name: string;
  customer_document: string | null;
  quotation_type: QuotationType;
  category: QuotationCategory;
  responsible_user_id: number;
  responsible_name: string;
  total_amount: number;
  expiration_date: string;
  status: QuotationStatus;
  version: number;
}

export interface StatusHistoryEntry {
  id: number;
  previous_status: QuotationStatus | null;
  new_status: QuotationStatus;
  changed_by_name: string;
  change_reason: string | null;
  created_at: string;
}

export interface VersionEntry {
  id: number;
  version_number: number;
  created_by_name: string;
  created_at: string;
  reason: string;
}

export interface ApprovalEntry {
  id: number;
  requested_by_name: string;
  approved_by_name: string | null;
  approval_type: string;
  status: 'pendente' | 'aprovado' | 'rejeitado';
  comments: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface ActivityEntry {
  id: number;
  activity_type: string;
  description: string;
  performed_by_name: string;
  created_at: string;
}

export interface QuotationDetail extends Quotation {
  history: StatusHistoryEntry[];
  versions: VersionEntry[];
  approvals: ApprovalEntry[];
  activities: ActivityEntry[];
  allowed_actions: QuotationAction[];
}

export type QuotationAction =
  | 'editar'
  | 'enviar_revisao'
  | 'solicitar_aprovacao'
  | 'aprovar_interno'
  | 'rejeitar_aprovacao'
  | 'registrar_envio'
  | 'registrar_negociacao'
  | 'aprovar_cliente'
  | 'recusar'
  | 'renovar'
  | 'nova_versao'
  | 'cancelar'
  | 'converter'
  | 'duplicar';

export interface TextTemplate {
  id: number;
  field: TemplateField;
  title: string;
  body: string;
  quotation_type: QuotationType | null;
}

export type TemplateField =
  | 'payment_terms'
  | 'delivery_terms'
  | 'warranty_terms'
  | 'pickup_delivery_terms'
  | 'customer_responsibilities'
  | 'return_conditions'
  | 'specific_conditions'
  | 'commercial_notes';

export const TEMPLATE_FIELD_LABELS: Record<TemplateField, string> = {
  payment_terms: 'Condições de pagamento',
  delivery_terms: 'Prazo de entrega',
  warranty_terms: 'Garantia',
  pickup_delivery_terms: 'Retirada / entrega',
  customer_responsibilities: 'Responsabilidades do cliente',
  return_conditions: 'Condições de devolução',
  specific_conditions: 'Condições específicas',
  commercial_notes: 'Observações comerciais',
};

export interface RentalPolicy {
  /** 'exclusive': dias = fim − início (01→02 = 1 diária). 'inclusive': conta o dia final (01→02 = 2 diárias). */
  day_count_mode: 'exclusive' | 'inclusive';
  /** Dias de um mês comercial para cobrança mensal. */
  days_per_month: number;
  /** true: períodos fracionados (10 dias semanal = 1,43 semana). false: arredonda para cima, com aviso. */
  proportional: boolean;
}

export interface CompanySettings {
  name: string;
  legal_name: string;
  document: string;
  phone: string;
  email: string;
  address: string;
  logo_data: string | null;
}

export interface ModuleSettings {
  company: CompanySettings;
  default_validity_days: number;
  discount_limits: Record<Role, number>; // % máximo de desconto efetivo sem aprovação
  seller_can_change_price: boolean;
  require_internal_approval: boolean; // true: só gestor/admin aprovam internamente
  rental_policy: RentalPolicy;
  expiring_soon_days: number;
}
