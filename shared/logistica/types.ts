/**
 * Tipos do módulo de Entregas e Devoluções (logística das operações físicas dos contratos).
 * A movimentação física em si é a do módulo de Contratos/Estoque; aqui ficam programação,
 * separação, transporte, recebimento, inspeção, ocorrências e documentos.
 */

export type OpType = 'entrega' | 'retirada' | 'devolucao';
export const OP_TYPE_LABELS: Record<OpType, string> = { entrega: 'Entrega', retirada: 'Retirada no cliente', devolucao: 'Devolução no balcão' };

export type DeliveryStatus = 'rascunho' | 'programada' | 'em_separacao' | 'pronta' | 'em_transporte' | 'entregue_parcialmente' | 'entregue' | 'cancelada';
export type ReturnStatus = 'rascunho' | 'programada' | 'em_andamento' | 'recebida_parcialmente' | 'recebida' | 'aguardando_inspecao' | 'em_conferencia' | 'concluida' | 'cancelada';
export type OpStatus = DeliveryStatus | ReturnStatus;

export const OP_STATUS_LABELS: Record<OpStatus, string> = {
  rascunho: 'Rascunho',
  programada: 'Programada',
  em_separacao: 'Em separação',
  pronta: 'Pronta para saída',
  em_transporte: 'Em transporte',
  entregue_parcialmente: 'Entregue parcialmente',
  entregue: 'Entregue',
  em_andamento: 'Em andamento',
  recebida_parcialmente: 'Recebida parcialmente',
  recebida: 'Recebida',
  aguardando_inspecao: 'Aguardando inspeção',
  em_conferencia: 'Em conferência',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export type PickupReason = 'fim_contrato' | 'antecipada' | 'substituicao' | 'manutencao' | 'outra';
export const PICKUP_REASON_LABELS: Record<PickupReason, string> = {
  fim_contrato: 'Devolução no encerramento do contrato',
  antecipada: 'Devolução antecipada',
  substituicao: 'Substituição de equipamento',
  manutencao: 'Retirada para manutenção',
  outra: 'Outro motivo autorizado',
};

export type TransportType = 'proprio' | 'terceiro' | 'cliente';
export const TRANSPORT_LABELS: Record<TransportType, string> = { proprio: 'Veículo próprio', terceiro: 'Transportadora/terceiro', cliente: 'Cliente retira/devolve' };

export const EXIT_CHECKLIST: { key: string; label: string; required: boolean }[] = [
  { key: 'conferido', label: 'Equipamentos e quantidades conferidos', required: true },
  { key: 'funcionando', label: 'Funcionamento testado antes da saída', required: true },
  { key: 'limpo', label: 'Equipamentos limpos', required: false },
  { key: 'acessorios', label: 'Acessórios separados conforme contrato', required: true },
  { key: 'documentos', label: 'Comprovante de entrega impresso', required: false },
];

export type InspectionResult = 'aprovado' | 'aguardando_inspecao' | 'avaria' | 'incompleto' | 'manutencao' | 'bloqueado';
export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  aprovado: 'Aprovado e disponível',
  aguardando_inspecao: 'Aguardando inspeção',
  avaria: 'Com avaria',
  incompleto: 'Incompleto (faltam acessórios/componentes)',
  manutencao: 'Encaminhado para manutenção',
  bloqueado: 'Bloqueado para nova locação',
};

export type OccurrenceType = 'avaria' | 'perda' | 'acessorio_faltante' | 'incompleto' | 'divergencia' | 'transporte' | 'outro';
export const OCCURRENCE_TYPE_LABELS: Record<OccurrenceType, string> = {
  avaria: 'Avaria',
  perda: 'Perda / não devolvido',
  acessorio_faltante: 'Acessório faltante',
  incompleto: 'Equipamento incompleto',
  divergencia: 'Divergência de quantidade',
  transporte: 'Ocorrência no transporte',
  outro: 'Outra',
};

export type OccurrenceStatus = 'registrada' | 'em_analise' | 'aguardando_orcamento' | 'aguardando_aprovacao' | 'aprovada_cobranca' | 'nao_cobravel' | 'encaminhada_manutencao' | 'resolvida';
export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  registrada: 'Registrada',
  em_analise: 'Em análise',
  aguardando_orcamento: 'Aguardando orçamento',
  aguardando_aprovacao: 'Aguardando aprovação',
  aprovada_cobranca: 'Aprovada para cobrança',
  nao_cobravel: 'Não passível de cobrança',
  encaminhada_manutencao: 'Encaminhada para manutenção',
  resolvida: 'Resolvida',
};

export type Responsibility = 'indefinida' | 'cliente' | 'empresa' | 'terceiro';
export const RESPONSIBILITY_LABELS: Record<Responsibility, string> = { indefinida: 'A apurar', cliente: 'Cliente', empresa: 'Empresa (desgaste/uso normal)', terceiro: 'Terceiro (transportadora etc.)' };

export interface OpItem {
  id: number;
  contract_item_id: number;
  item_id: number;
  item_code: string;
  description: string;
  unit: string;
  tracking: 'quantidade' | 'individual';
  asset_id: number | null;
  asset_tag: string | null;
  serial_number: string | null;
  quantity_original: number;
  quantity_planned: number;
  quantity_separated: number;
  quantity_processed: number;
  quantity_missing: number;
  quantity_inspected: number;
  condition_before: string | null; // na devolução: estado registrado na entrega original
  origin_order_number: string | null; // entrega original (para comparar fotos e estado)
  condition_after: string | null;
  adjust_reason: string | null;
  notes: string | null;
  // situação atual (equipamento individual)
  operational_status: string | null;
  contract_quantity: number;
  contract_delivered: number; // com o cliente agora
  contract_returned: number;
}

export interface Inspection {
  id: number;
  order_item_id: number;
  asset_tag: string | null;
  item_code: string;
  quantity: number;
  result: InspectionResult;
  checklist: Record<string, boolean>;
  condition: string | null;
  damage_detected: boolean;
  notes: string | null;
  work_order_id: number | null;
  work_order_number: string | null;
  inspected_by_name: string;
  inspected_at: string;
}

export interface Occurrence {
  id: number;
  number: string;
  order_id: number | null;
  order_number: string | null;
  contract_id: number;
  contract_number: string;
  customer_name: string;
  asset_tag: string | null;
  item_code: string | null;
  occurrence_type: OccurrenceType;
  description: string;
  estimated_cost: number | null;
  approved_cost: number | null;
  responsibility: Responsibility;
  status: OccurrenceStatus;
  analysis_notes: string | null;
  resolution_notes: string | null;
  work_order_number: string | null;
  charge_entry_number: string | null;
  registered_by_name: string;
  approved_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpRow {
  id: number;
  number: string;
  op_type: OpType;
  status: OpStatus;
  contract_id: number;
  contract_number: string;
  customer_name: string;
  address: string | null;
  scheduled_at: string;
  responsible_name: string | null;
  driver_name: string | null;
  items_count: number;
  quantity_total: number;
  pending: string | null;
  late: boolean;
}

export interface OpAttachment {
  id: number;
  phase: string;
  category: string;
  title: string;
  file_name: string;
  mime_type: string;
  occurrence_id: number | null;
  uploaded_by_name: string;
  created_at: string;
}
export const ATTACHMENT_PHASES: Record<string, string> = { saida: 'Saída (antes da entrega)', entrega: 'Entrega no cliente', retorno: 'Retorno', inspecao: 'Inspeção', documento: 'Documento / comprovante' };

export interface OpDetail {
  id: number;
  number: string;
  op_type: OpType;
  status: OpStatus;
  reason: PickupReason | null;
  contract: { id: number; contract_number: string; contract_type: string; status: string; start_date: string; end_date: string | null };
  customer: { id: number; name: string; document: string | null; phone: string | null; email: string | null; address: string | null };
  scheduled_at: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  access_instructions: string | null;
  special_equipment: string | null;
  transport_type: TransportType;
  driver_id: number | null;
  driver_name: string | null;
  vehicle_id: number | null;
  vehicle_label: string | null;
  carrier_supplier_id: number | null;
  carrier_name: string | null;
  responsible_user_id: number | null;
  responsible_name: string | null;
  origin_address: string | null;
  separated_by_name: string | null;
  separated_at: string | null;
  separation_checklist: Record<string, boolean>;
  accessories: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  receiver_name: string | null;
  receiver_document: string | null;
  transport_notes: string | null;
  transport_cost_estimated: number | null;
  transport_cost_actual: number | null;
  transport_entry_number: string | null;
  contract_operation_number: string | null;
  notes: string | null;
  cancel_reason: string | null;
  created_by_name: string;
  created_at: string;
  row_version: number;
  items: OpItem[];
  inspections: Inspection[];
  occurrences: Occurrence[];
  attachments: OpAttachment[];
  events: { id: number; event_type: string; previous_status: OpStatus | null; new_status: OpStatus | null; description: string; performed_by_name: string | null; created_at: string }[];
  actions: string[];
  blockers: Record<string, string>;
}
