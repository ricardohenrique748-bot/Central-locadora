/**
 * Tipos do módulo de Contratos (locação e venda de equipamentos).
 * Valores em centavos inteiros; datas YYYY-MM-DD; quantidades podem ser fracionadas (estoque).
 */

import { CustomerSnapshot } from '../orcamentos/types';

export type ContractType = 'locacao' | 'venda';
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = { locacao: 'Locação', venda: 'Venda' };

export type ContractStatus =
  | 'rascunho'
  | 'aguardando_aprovacao'
  | 'aprovado'
  | 'aguardando_assinatura'
  | 'agendado'
  | 'ativo'
  | 'vencido'
  | 'pendente_devolucao'
  | 'encerrado'
  | 'cancelado';

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  rascunho: 'Rascunho',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  aguardando_assinatura: 'Aguardando assinatura',
  agendado: 'Agendado',
  ativo: 'Ativo',
  vencido: 'Vencido',
  pendente_devolucao: 'Pendente de devolução',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};

/** Status em que o contrato produz efeitos (equipamentos com o cliente, cobranças). */
export const LIVE_STATUSES: ContractStatus[] = ['agendado', 'ativo', 'vencido', 'pendente_devolucao'];
export const CLOSED_STATUSES: ContractStatus[] = ['encerrado', 'cancelado'];

export type BillingFrequency = 'diaria' | 'semanal' | 'quinzenal' | 'mensal' | 'personalizado' | 'unico';
export const BILLING_FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
  personalizado: 'Período personalizado',
  unico: 'Valor único',
};
/** Nome do período usado no preço ("R$ 100 por ..."). */
export const PERIOD_NOUN: Record<BillingFrequency, string> = {
  diaria: 'dia',
  semanal: 'semana',
  quinzenal: 'quinzena',
  mensal: 'mês',
  personalizado: 'período',
  unico: 'contrato',
};

export type BillingTiming = 'antecipado' | 'postecipado';
export const BILLING_TIMING_LABELS: Record<BillingTiming, string> = { antecipado: 'No início de cada período', postecipado: 'Ao final de cada período' };

export type Responsibility = 'locadora' | 'cliente' | 'a_combinar' | 'nao_se_aplica';
export const RESPONSIBILITY_LABELS: Record<Responsibility, string> = { locadora: 'Locadora', cliente: 'Cliente', a_combinar: 'A combinar', nao_se_aplica: 'Não se aplica' };
export const RESPONSIBILITY_TOPICS = [
  { key: 'transporte', label: 'Transporte' },
  { key: 'combustivel', label: 'Combustível' },
  { key: 'manutencao', label: 'Manutenção' },
  { key: 'avarias', label: 'Avarias' },
] as const;
export type ResponsibilityKey = (typeof RESPONSIBILITY_TOPICS)[number]['key'];

export type ItemModality = 'locacao' | 'venda';

export interface ContractItemInput {
  id?: number;
  item_id: number;
  asset_id: number | null;
  quantity: number;
  modality: ItemModality;
  unit_price: number; // por período (locação) ou por unidade (venda)
  discount_amount: number; // total da linha (por período na locação)
  notes: string | null;
  conditions: string | null;
}

export interface ContractItem extends ContractItemInput {
  id: number;
  position: number;
  item_code: string;
  description: string;
  unit: string;
  tracking: 'quantidade' | 'individual';
  asset_tag: string | null;
  serial_number: string | null;
  line_total: number;
  /** Situação física derivada das reservas do Estoque. */
  reserved_qty: number;
  delivered_qty: number; // com o cliente agora
  returned_qty: number;
  sold_delivered_qty: number; // itens de venda já entregues
}

export interface ContractInput {
  contract_type: ContractType;
  customer_id: number;
  customer_contact: string | null; // pessoa de contato (o cadastro de clientes não tem esse campo)
  start_date: string;
  end_date: string | null; // null = prazo indeterminado (locação)
  responsible_user_id: number;
  approver_user_id: number | null;
  delivery_address: string | null;
  internal_notes: string | null;
  // condições comerciais
  billing_frequency: BillingFrequency;
  custom_period_days: number | null;
  billing_timing: BillingTiming;
  due_day: number | null;
  due_days_after: number;
  proportional_last: boolean;
  /** locação com término: valor total da vigência numa única cobrança */
  single_charge: boolean;
  general_discount: number; // por período (locação) ou sobre o total (venda)
  freight_delivery: number;
  freight_pickup: number;
  other_fees: number;
  other_fees_description: string | null;
  deposit_amount: number;
  late_fee_percent: number;
  interest_month_percent: number;
  adjustment_index: string | null;
  adjustment_period_months: number | null;
  responsibilities: Record<ResponsibilityKey, Responsibility>;
  payment_terms: string | null;
  special_conditions: string | null;
  // venda
  installments_count: number;
  first_due_date: string | null;
  items: ContractItemInput[];
}

export interface ContractTotals {
  rental_subtotal: number; // Σ linhas de locação por período
  period_amount: number; // valor recorrente por período (após desconto geral)
  sale_subtotal: number;
  sale_total: number;
  one_time_total: number; // fretes e taxas
  estimated_total: number | null; // null em prazo indeterminado
  monthly_equivalent: number; // receita mensal equivalente (locação)
}

export interface Contract extends Omit<ContractInput, 'items'>, ContractTotals {
  id: number;
  contract_number: string;
  status: ContractStatus;
  source: 'manual' | 'orcamento';
  quotation_id: number | null;
  quotation_number: string | null;
  customer_snapshot: CustomerSnapshot & { contact_name?: string | null; city?: string | null; state?: string | null };
  responsible_name: string;
  approver_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  signed_at: string | null;
  activated_at: string | null;
  closed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  items: ContractItem[];
}

export interface ContractListRow {
  id: number;
  contract_number: string;
  contract_type: ContractType;
  status: ContractStatus;
  customer_id: number;
  customer_name: string;
  customer_document: string | null;
  start_date: string;
  end_date: string | null;
  billing_frequency: BillingFrequency;
  period_amount: number;
  estimated_total: number | null;
  responsible_name: string;
  attention: string | null;
}

// ------------------------------------------------ cobranças (cronograma)

export type ChargeKind = 'periodo' | 'parcela' | 'unico' | 'frete' | 'taxa' | 'venda_item' | 'extra';
export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  periodo: 'Período de locação',
  parcela: 'Parcela',
  unico: 'Valor único',
  frete: 'Frete',
  taxa: 'Taxa',
  venda_item: 'Itens vendidos',
  extra: 'Cobrança extraordinária',
};

/** Situação da cobrança vista do contrato; o pagamento vem SEMPRE do Financeiro. */
export type ChargeDisplayStatus = 'previsto' | 'em_aberto' | 'vencido' | 'parcial' | 'pago' | 'cancelado';
export const CHARGE_STATUS_LABELS: Record<ChargeDisplayStatus, string> = {
  previsto: 'Prevista (não gerada)',
  em_aberto: 'Em aberto',
  vencido: 'Vencida',
  parcial: 'Paga parcialmente',
  pago: 'Paga',
  cancelado: 'Cancelada',
};

export interface ScheduleLine {
  kind: ChargeKind;
  description: string;
  period_start: string;
  period_end: string; // inclusivo
  due_date: string;
  amount: number;
  proportional?: boolean;
}

export interface ContractCharge extends ScheduleLine {
  id: number;
  status: 'previsto' | 'gerado' | 'cancelado';
  display_status: ChargeDisplayStatus;
  financial_entry_id: number | null;
  entry_number: string | null;
  settled_amount: number;
  updated_amount: number;
  generated_at: string | null;
  cancel_reason: string | null;
}

export interface FinancialSummary {
  contracted: number | null; // valor contratado estimado
  scheduled: number; // cobranças geradas (não canceladas)
  received: number; // recebido no Financeiro
  open: number; // gerado − recebido
  overdue: number;
  not_generated: number; // previsto ainda não lançado
}

// ------------------------------------------------ operações físicas

export type OperationType = 'entrega' | 'devolucao';
export type ReturnClassification = 'disponivel' | 'aguardando_inspecao' | 'avaria' | 'manutencao';
export const RETURN_CLASS_LABELS: Record<ReturnClassification, string> = {
  disponivel: 'Devolvido e disponível (conferido)',
  aguardando_inspecao: 'Aguardando inspeção / conferência',
  avaria: 'Devolvido com avaria',
  manutencao: 'Encaminhado para manutenção',
};

export interface OperationItem {
  id: number;
  contract_item_id: number;
  item_code: string;
  description: string;
  asset_tag: string | null;
  quantity: number;
  condition: string | null;
  classification: ReturnClassification | null;
  damaged_qty: number;
  maintenance_qty: number;
  missing_qty: number;
  notes: string | null;
}

export interface Operation {
  id: number;
  number: string;
  operation_type: OperationType;
  performed_at: string;
  responsible_name: string;
  counterpart_name: string | null;
  counterpart_document: string | null;
  accessories: string | null;
  checklist: Record<string, boolean>;
  notes: string | null;
  items: OperationItem[];
  created_at: string;
}

export const DELIVERY_CHECKLIST: { key: string; label: string }[] = [
  { key: 'conferido', label: 'Equipamentos conferidos com o cliente' },
  { key: 'funcionando', label: 'Funcionamento demonstrado' },
  { key: 'acessorios', label: 'Acessórios entregues conforme lista' },
  { key: 'orientacao', label: 'Orientações de uso e segurança passadas' },
];

// ------------------------------------------------ vigências, aditivos, documentos, eventos

export type AmendmentType = 'prorrogacao' | 'renovacao' | 'reajuste' | 'alteracao';
export const AMENDMENT_LABELS: Record<AmendmentType, string> = { prorrogacao: 'Prorrogação', renovacao: 'Renovação', reajuste: 'Reajuste de valores', alteracao: 'Alteração contratual' };

export interface Amendment {
  id: number;
  number: number;
  amendment_type: AmendmentType;
  description: string;
  reason: string;
  previous_end: string | null;
  new_end: string | null;
  previous_amount: number | null;
  new_amount: number | null;
  effective_date: string | null;
  created_by_name: string;
  created_at: string;
}

export type DocumentType = 'contrato' | 'aditivo' | 'comprovante_entrega' | 'comprovante_devolucao' | 'anexo';
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  contrato: 'Contrato',
  aditivo: 'Aditivo',
  comprovante_entrega: 'Comprovante de entrega',
  comprovante_devolucao: 'Comprovante de devolução',
  anexo: 'Anexo',
};
export type DocumentStatus = 'gerado' | 'enviado' | 'assinado' | 'substituido';
export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = { gerado: 'Gerado', enviado: 'Enviado', assinado: 'Assinado (evidência registrada)', substituido: 'Substituído por nova versão' };
export type SignatureMethod = 'presencial' | 'digitalizado' | 'plataforma_externa';
export const SIGNATURE_METHOD_LABELS: Record<SignatureMethod, string> = {
  presencial: 'Assinado em papel (via física arquivada)',
  digitalizado: 'Via assinada digitalizada (anexo)',
  plataforma_externa: 'Plataforma de assinatura externa',
};

export interface ContractDocument {
  id: number;
  document_type: DocumentType;
  title: string;
  version: number;
  status: DocumentStatus;
  file_name: string | null;
  mime_type: string | null;
  has_file: boolean;
  generated: boolean;
  operation_id: number | null;
  amendment_id: number | null;
  issued_at: string;
  issued_by_name: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  signed_at: string | null;
  signed_by_names: string | null;
  signature_method: SignatureMethod | null;
  signature_evidence: string | null;
}

export interface ContractEvent {
  id: number;
  event_type: string;
  previous_status: ContractStatus | null;
  new_status: ContractStatus | null;
  description: string;
  performed_by_name: string | null;
  created_at: string;
}

export interface ContractDetail extends Contract {
  charges: ContractCharge[];
  schedule_preview: ScheduleLine[];
  financial: FinancialSummary | null; // null = perfil sem acesso a valores financeiros
  operations: Operation[];
  amendments: Amendment[];
  terms: { id: number; start_date: string; end_date: string | null; period_amount: number; reason: string; created_by_name: string; created_at: string }[];
  documents: ContractDocument[];
  events: ContractEvent[];
  reservations: { id: number; number: string; contract_item_id: number | null; item_code: string; asset_tag: string | null; quantity: number; start_date: string; end_date: string; status: string }[];
  actions: ContractAction[];
  blockers: Partial<Record<ContractAction, string>>;
}

export type ContractAction =
  | 'editar'
  | 'enviar_aprovacao'
  | 'aprovar'
  | 'rejeitar'
  | 'reabrir'
  | 'gerar_documento'
  | 'registrar_assinatura'
  | 'reservar'
  | 'ativar'
  | 'entregar'
  | 'devolver'
  | 'prorrogar'
  | 'reajustar'
  | 'incluir_itens'
  | 'gerar_cobrancas'
  | 'cobranca_extra'
  | 'iniciar_encerramento'
  | 'encerrar'
  | 'cancelar';

export const ACTION_LABELS: Record<ContractAction, string> = {
  editar: 'Editar',
  enviar_aprovacao: 'Enviar para aprovação',
  aprovar: 'Aprovar',
  rejeitar: 'Devolver para ajustes',
  reabrir: 'Reabrir para edição',
  gerar_documento: 'Gerar documento',
  registrar_assinatura: 'Registrar assinatura',
  reservar: 'Reservar equipamentos',
  ativar: 'Ativar',
  entregar: 'Registrar entrega',
  devolver: 'Registrar devolução',
  prorrogar: 'Renovar / prorrogar',
  reajustar: 'Reajustar valores',
  incluir_itens: 'Incluir itens',
  gerar_cobrancas: 'Gerar cobranças',
  cobranca_extra: 'Cobrança extraordinária',
  iniciar_encerramento: 'Iniciar encerramento',
  encerrar: 'Encerrar',
  cancelar: 'Cancelar',
};

export interface ContractSettings {
  require_approval: boolean;
  approval_limit: number; // acima disso exige aprovação mesmo se require_approval = false (0 = nunca)
  require_signature_to_activate: boolean;
  alert_days: number[];
  charge_horizon_months: number; // prazo indeterminado: gera cobranças até N meses à frente
  default_due_days_after: number;
  block_close_with_open_charges: boolean;
  require_inspection_before_close: boolean;
  contract_template: string;
  /** Assinatura da locadora já impressa no contrato e nos aditivos (imagem PNG/JPG em data URL). */
  lessor_signature: string | null;
  /** Nome do representante que assina pela locadora (aparece sob a assinatura). */
  lessor_signatory: string;
}

export interface ContractAlert {
  kind: string;
  label: string;
  priority: 'alta' | 'media' | 'baixa';
  contract_id: number;
  contract_number: string;
  customer_name: string;
  responsible_user_id: number;
  responsible_name: string;
  date: string | null;
  text: string;
}
