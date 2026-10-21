/**
 * Tipos do módulo de Ordens de Serviço (manutenção de equipamentos).
 * Valores em centavos inteiros; datas YYYY-MM-DD; data/hora em ISO.
 */

export type OrderStatus =
  | 'aberta'
  | 'aguardando_avaliacao'
  | 'aguardando_aprovacao'
  | 'aguardando_pecas'
  | 'aguardando_fornecedor'
  | 'programada'
  | 'em_execucao'
  | 'em_testes'
  | 'concluida'
  | 'cancelada';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  aberta: 'Aberta',
  aguardando_avaliacao: 'Aguardando avaliação',
  aguardando_aprovacao: 'Aguardando aprovação',
  aguardando_pecas: 'Aguardando peças',
  aguardando_fornecedor: 'Aguardando fornecedor',
  programada: 'Programada',
  em_execucao: 'Em execução',
  em_testes: 'Em testes',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
export const OPEN_STATUSES: OrderStatus[] = ['aberta', 'aguardando_avaliacao', 'aguardando_aprovacao', 'aguardando_pecas', 'aguardando_fornecedor', 'programada', 'em_execucao', 'em_testes'];

export const BASE_ORDER_TYPES: Record<string, string> = {
  corretiva: 'Manutenção corretiva',
  preventiva: 'Manutenção preventiva',
  inspecao: 'Inspeção técnica',
  revisao: 'Revisão periódica',
  avaria: 'Reparo por avaria',
  instalacao: 'Instalação ou montagem',
  desmontagem: 'Desmontagem',
  garantia: 'Garantia',
  terceirizado: 'Serviço terceirizado',
  outro: 'Outro',
};

export type Priority = 'baixa' | 'media' | 'alta' | 'urgente';
export const PRIORITY_LABELS: Record<Priority, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };

export type Origin = 'interna' | 'cliente' | 'devolucao' | 'preventiva' | 'contrato' | 'outra';
export const ORIGIN_LABELS: Record<Origin, string> = {
  interna: 'Equipe interna',
  cliente: 'Solicitação do cliente',
  devolucao: 'Inspeção na devolução',
  preventiva: 'Plano preventivo',
  contrato: 'Ocorrência em contrato',
  outra: 'Outra',
};

export type Risk = 'nenhum' | 'baixo' | 'medio' | 'alto';
export const RISK_LABELS: Record<Risk, string> = { nenhum: 'Sem risco', baixo: 'Baixo', medio: 'Médio', alto: 'Alto (impede o uso)' };

export interface OrderTypeRule {
  key: string;
  label: string;
  requires_diagnosis: boolean;
  requires_checklist: boolean;
}

export interface AssetSnapshot {
  asset_id: number;
  item_id: number;
  item_code: string;
  description: string;
  asset_tag: string;
  serial_number: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  location_name: string | null;
}

export interface OrderListRow {
  id: number;
  order_number: string;
  asset_id: number;
  asset_tag: string;
  serial_number: string | null;
  item_description: string;
  order_type: string;
  title: string;
  priority: Priority;
  opened_at: string;
  due_date: string | null;
  responsible_name: string | null;
  status: OrderStatus;
  actual_cost: number;
  blocks_equipment: boolean;
  overdue: boolean;
}

export interface Material {
  id: number;
  item_id: number;
  item_code: string;
  description: string;
  unit: string;
  kind: 'peca' | 'material';
  quantity_requested: number;
  quantity_reserved: number;
  quantity_withdrawn: number;
  quantity_returned: number;
  quantity_used: number;
  location_id: number | null;
  location_name: string | null;
  unit_cost: number | null; // custo médio das retiradas
  estimated_unit_cost: number | null;
  available_now: number | null;
  status: 'ativo' | 'cancelado';
  notes: string | null;
  moves: { id: number; move_type: string; quantity: number; movement_number: string | null; performed_by_name: string; created_at: string }[];
}

export interface Activity {
  id: number;
  description: string;
  technician_user_id: number | null;
  technician_name: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  hourly_rate: number;
  labor_cost: number;
  notes: string | null;
  voided: boolean;
  void_reason: string | null;
  created_at: string;
}

export type ServiceStatus = 'pendente_aprovacao' | 'aprovado' | 'reprovado' | 'concluido' | 'cancelado';
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  pendente_aprovacao: 'Aguardando aprovação',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export interface OutsourcedService {
  id: number;
  supplier_id: number;
  supplier_name: string;
  description: string;
  supplier_document: string | null;
  estimated_cost: number;
  approved_cost: number | null;
  actual_cost: number | null;
  expected_date: string | null;
  completed_date: string | null;
  status: ServiceStatus;
  approved_by_name: string | null;
  financial_entry_id: number | null;
  entry_number: string | null;
  notes: string | null;
}

export type ChecklistResult = 'aprovado' | 'reprovado' | 'nao_aplicavel';
export const CHECKLIST_RESULT_LABELS: Record<ChecklistResult, string> = { aprovado: 'Aprovado', reprovado: 'Reprovado', nao_aplicavel: 'Não aplicável' };

export interface ChecklistItem {
  id: number;
  label: string;
  required: boolean;
  result: ChecklistResult | null;
  notes: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
}

export interface CostSummary {
  estimated: { parts: number; materials: number; labor: number; services: number; other: number; total: number };
  actual: { parts: number; materials: number; labor: number; services: number; other: number; total: number };
  difference: number; // realizado − previsto
  payable: number; // encaminhado ao Financeiro (obrigação), distinto do custo técnico
}

export interface TimeSummary {
  waiting_evaluation_min: number;
  waiting_approval_min: number;
  waiting_parts_min: number;
  waiting_supplier_min: number;
  execution_status_min: number;
  testing_min: number;
  worked_min: number; // soma das atividades (tempo efetivo)
  downtime_min: number | null; // equipamento bloqueado
}

export interface OrderEvent {
  id: number;
  event_type: string;
  previous_status: OrderStatus | null;
  new_status: OrderStatus | null;
  description: string;
  performed_by_name: string | null;
  created_at: string;
}

export interface Attachment {
  id: number;
  category: string;
  title: string;
  file_name: string;
  mime_type: string;
  uploaded_by_name: string;
  created_at: string;
}
export const ATTACHMENT_CATEGORIES: Record<string, string> = {
  foto_defeito: 'Foto do defeito',
  antes: 'Foto antes',
  depois: 'Foto depois',
  orcamento: 'Orçamento de reparo',
  nota_fiscal: 'Nota fiscal',
  laudo: 'Laudo técnico',
  comprovante: 'Comprovante',
  checklist: 'Checklist',
  outro: 'Outro',
};

export interface WorkOrder {
  id: number;
  order_number: string;
  status: OrderStatus;
  order_type: string;
  order_type_label: string;
  origin: Origin;
  requester: string | null;
  responsible_user_id: number | null;
  responsible_name: string | null;
  priority: Priority;
  due_date: string | null;
  scheduled_at: string | null;
  title: string;
  description: string | null;
  symptoms: string | null;
  defect_category: string | null;
  probable_cause: string | null;
  diagnosis: string | null;
  root_cause: string | null;
  requested_service: string | null;
  procedures: string | null;
  operational_risk: Risk;
  blocks_equipment: boolean;
  requires_checklist: boolean;
  test_result: string | null;
  safety_notes: string | null;
  recommendations: string | null;
  notes: string | null;
  meter_reading: number | null;
  estimated_labor: number;
  estimated_other: number;
  actual_other: number;
  actual_other_description: string | null;
  cost_approved_by_name: string | null;
  cost_approved_at: string | null;
  asset: AssetSnapshot;
  asset_now: { operational_status: string; rental_status: string; location_name: string | null };
  contract: { id: number; contract_number: string; customer_name: string } | null;
  plan: { id: number; name: string } | null;
  opened_at: string;
  started_at: string | null;
  completed_at: string | null;
  downtime_start: string | null;
  downtime_end: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by_name: string;
  row_version: number;
}

export interface OrderDetail extends WorkOrder {
  materials: Material[];
  activities: Activity[];
  services: OutsourcedService[];
  checklist: ChecklistItem[];
  attachments: Attachment[];
  events: OrderEvent[];
  costs: CostSummary | null; // null = perfil sem acesso a custos
  times: TimeSummary;
  affected_reservations: { number: string; start_date: string; end_date: string; contract_ref: string | null; status: string }[];
  transitions: OrderStatus[];
  actions: string[];
  blockers: Record<string, string>;
}

export interface OsSettings {
  approval_limit: number;
  maintenance_category_id: number | null;
  custom_types: OrderTypeRule[];
  due_days: Record<Priority, number>;
  preventive_lead_days: number;
}

export interface MaintenancePlan {
  id: number;
  name: string;
  description: string | null;
  asset_id: number | null;
  asset_tag: string | null;
  category: string | null;
  interval_days: number | null;
  interval_hours: number | null;
  interval_cycles: number | null;
  checklist_template_id: number | null;
  responsible_user_id: number | null;
  responsible_name: string | null;
  estimated_minutes: number | null;
  lead_days: number;
  active: boolean;
  notes: string | null;
  schedules: { asset_id: number; asset_tag: string; next_due_date: string | null; next_due_meter: number | null; last_done_at: string | null; last_meter: number | null; current_meter: number | null; open_order: string | null }[];
}

export interface ChecklistTemplate {
  id: number;
  name: string;
  category: string | null;
  items: { label: string; required: boolean }[];
  active: boolean;
}
