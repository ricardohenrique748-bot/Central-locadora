/**
 * Central Locação - Módulo de Estoque: tipos compartilhados entre servidor e interface.
 * Valores monetários em CENTAVOS inteiros. Quantidades com até 3 casas decimais.
 * Datas de reserva/locação no formato YYYY-MM-DD.
 */

/** Tipo de item no estoque (o catálogo dos orçamentos usa a mesma tabela). */
export type ItemKind = 'produto_venda' | 'equipamento_locacao' | 'venda_locacao' | 'peca' | 'acessorio' | 'consumo';

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  produto_venda: 'Produto para venda',
  equipamento_locacao: 'Equipamento para locação',
  venda_locacao: 'Produto para venda e locação',
  peca: 'Peça de reposição',
  acessorio: 'Acessório',
  consumo: 'Material de consumo',
};

/** quantidade = saldo numérico; individual = cada unidade tem patrimônio/série próprios. */
export type Tracking = 'quantidade' | 'individual';

export const TRACKING_LABELS: Record<Tracking, string> = {
  quantidade: 'Por quantidade',
  individual: 'Individual (patrimônio / nº de série)',
};

export interface StockItem {
  id: number;
  internal_code: string;
  description: string; // nome do item
  long_description: string | null;
  kind: ItemKind;
  tracking: Tracking;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  model: string | null;
  unit: string;
  barcode: string | null;
  notes: string | null;
  image_data: string | null;
  active: boolean;
  sale_enabled: boolean;
  rental_enabled: boolean;
  // comercial
  acquisition_cost: number | null; // último custo de aquisição (referência)
  average_cost: number | null; // custo médio ponderado (itens por quantidade)
  sale_price: number | null;
  daily_rental_price: number | null;
  weekly_rental_price: number | null;
  monthly_rental_price: number | null;
  custom_rental_price: number | null;
  main_supplier_id: number | null;
  supplier_code: string | null;
  last_purchase_date: string | null;
  // controle
  min_qty: number | null;
  max_qty: number | null;
  default_location_id: number | null;
  allow_negative: boolean;
  technical_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockItem {
  /** Tipo usado nos orçamentos (derivado de `kind`). */
  item_type: 'equipamento' | 'produto' | 'peca' | 'acessorio';
}

export type StockItemInput = Omit<StockItem, 'id' | 'item_type' | 'average_cost' | 'last_purchase_date' | 'created_at' | 'updated_at'>;

/** Linha da listagem com saldos consolidados. */
export interface StockItemRow extends StockItem {
  qty_physical: number; // em todos os locais
  qty_reserved: number;
  qty_unavailable: number; // avariado / manutenção / aguardando inspeção (itens por quantidade)
  qty_available: number;
  qty_in_transit: number;
  qty_on_rent: number; // com clientes (locação em uso)
  assets_total: number; // itens individuais
  assets_available: number;
  supplier_name: string | null;
}

export interface Balance {
  item_id: number;
  location_id: number;
  location_name: string;
  quantity: number;
  reserved: number;
  unavailable: number;
}

export type LocationType = 'deposito' | 'filial' | 'patio' | 'oficina' | 'outro';
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  deposito: 'Depósito',
  filial: 'Filial',
  patio: 'Pátio',
  oficina: 'Oficina',
  outro: 'Outro',
};

export interface StockLocation {
  id: number;
  code: string;
  name: string;
  location_type: LocationType;
  address: string | null;
  responsible: string | null;
  active: boolean;
}

export interface Supplier {
  id: number;
  person_type: 'PF' | 'PJ';
  name: string;
  trade_name: string | null;
  document: string | null;
  state_registration: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

// ------------------------------------------------ movimentações

export type MovementType =
  | 'entrada_compra'
  | 'entrada_inicial'
  | 'saida_venda'
  | 'saida_consumo'
  | 'saida_locacao'
  | 'retorno_locacao'
  | 'devolucao_venda'
  | 'transferencia_saida'
  | 'transferencia_entrada'
  | 'ajuste_positivo'
  | 'ajuste_negativo'
  | 'baixa_perda_avaria'
  | 'envio_manutencao'
  | 'retorno_manutencao'
  | 'outra_entrada'
  | 'outra_saida'
  | 'consumo_os'
  | 'devolucao_os'
  | 'estorno';

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  entrada_compra: 'Entrada por compra',
  entrada_inicial: 'Entrada inicial',
  saida_venda: 'Saída por venda confirmada',
  saida_consumo: 'Saída para consumo interno',
  saida_locacao: 'Saída para locação',
  retorno_locacao: 'Retorno de locação',
  devolucao_venda: 'Entrada por devolução de venda',
  transferencia_saida: 'Transferência (envio)',
  transferencia_entrada: 'Transferência (recebimento)',
  ajuste_positivo: 'Ajuste positivo',
  ajuste_negativo: 'Ajuste negativo',
  baixa_perda_avaria: 'Baixa por perda ou avaria',
  envio_manutencao: 'Envio para manutenção',
  retorno_manutencao: 'Retorno de manutenção',
  outra_entrada: 'Outra entrada autorizada',
  outra_saida: 'Outra saída autorizada',
  consumo_os: 'Saída para ordem de serviço',
  devolucao_os: 'Devolução de material da OS',
  estorno: 'Estorno',
};

export type MovementStatus = 'rascunho' | 'confirmado' | 'estornado';

export interface Movement {
  id: number;
  number: string;
  movement_type: MovementType;
  status: MovementStatus;
  item_id: number;
  item_code: string;
  item_description: string;
  asset_id: number | null;
  asset_tag: string | null;
  quantity: number;
  qty_delta: number; // efeito no saldo físico do local (origem ou destino)
  unavailable_delta: number; // efeito no saldo indisponível
  origin_location_id: number | null;
  origin_name: string | null;
  dest_location_id: number | null;
  dest_name: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  reference_doc: string | null;
  reason: string | null;
  notes: string | null;
  document_type: string | null;
  document_id: number | null;
  reversal_of_id: number | null;
  created_by_name: string;
  confirmed_at: string | null;
  created_at: string;
}

// ------------------------------------------------ equipamentos individuais

export type OperationalStatus = 'novo' | 'operacional' | 'aguardando_inspecao' | 'em_manutencao' | 'danificado' | 'baixado';
export const OPERATIONAL_LABELS: Record<OperationalStatus, string> = {
  novo: 'Novo',
  operacional: 'Operacional',
  aguardando_inspecao: 'Aguardando inspeção',
  em_manutencao: 'Em manutenção',
  danificado: 'Danificado',
  baixado: 'Baixado',
};

export type RentalStatus = 'disponivel' | 'reservado' | 'alugado' | 'em_transito' | 'indisponivel';
export const RENTAL_LABELS: Record<RentalStatus, string> = {
  disponivel: 'Disponível',
  reservado: 'Reservado',
  alugado: 'Alugado',
  em_transito: 'Em trânsito',
  indisponivel: 'Indisponível',
};

export type Conservation = 'novo' | 'bom' | 'regular' | 'ruim';
export const CONSERVATION_LABELS: Record<Conservation, string> = { novo: 'Novo', bom: 'Bom', regular: 'Regular', ruim: 'Ruim' };

export interface Asset {
  id: number;
  item_id: number;
  item_code: string;
  item_description: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  asset_tag: string;
  serial_number: string | null;
  acquisition_date: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  acquisition_cost: number | null;
  conservation: Conservation;
  operation_start_date: string | null;
  warranty_until: string | null;
  location_id: number | null;
  location_name: string | null;
  operational_status: OperationalStatus;
  rental_status: RentalStatus;
  technical_notes: string | null;
  notes: string | null;
  written_off_at: string | null;
  write_off_reason: string | null;
  created_at: string;
}

export interface AssetEvent {
  id: number;
  event_type: string;
  description: string;
  performed_by_name: string;
  created_at: string;
}

export interface AssetFile {
  id: number;
  kind: 'foto' | 'documento';
  name: string;
  mime: string;
  size: number;
  uploaded_by_name: string;
  created_at: string;
}

export interface AssetDetail extends Asset {
  events: AssetEvent[];
  files: AssetFile[];
  movements: Movement[];
  reservations: Reservation[];
  last_reservation: Reservation | null;
  next_reservation: Reservation | null;
}

// ------------------------------------------------ reservas / locação

export type ReservationStatus = 'pendente' | 'confirmada' | 'em_uso' | 'concluida' | 'cancelada';
export const RESERVATION_LABELS: Record<ReservationStatus, string> = {
  pendente: 'Pendente',
  confirmada: 'Confirmada',
  em_uso: 'Em uso (entregue)',
  concluida: 'Concluída (devolvida)',
  cancelada: 'Cancelada',
};

export interface Reservation {
  id: number;
  number: string;
  item_id: number;
  item_code: string;
  item_description: string;
  asset_id: number | null;
  asset_tag: string | null;
  quantity: number;
  start_date: string;
  end_date: string;
  status: ReservationStatus;
  customer_id: number | null;
  customer_name: string | null;
  quotation_id: number | null;
  quotation_number: string | null;
  contract_ref: string | null;
  location_id: number | null;
  location_name: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  returned_qty: number | null;
  damaged_qty: number | null;
  missing_qty: number | null;
  notes: string | null;
  created_by_name: string;
  created_at: string;
}

export interface Inspection {
  id: number;
  asset_id: number | null;
  reservation_id: number | null;
  result: 'aprovado' | 'manutencao' | 'danificado';
  checklist: Record<string, boolean>;
  notes: string | null;
  inspected_by_name: string;
  created_at: string;
}

export const INSPECTION_CHECKLIST: { key: string; label: string }[] = [
  { key: 'limpo', label: 'Equipamento limpo' },
  { key: 'funcionando', label: 'Funcionamento testado e normal' },
  { key: 'acessorios', label: 'Acessórios completos' },
  { key: 'sem_danos', label: 'Sem danos aparentes na estrutura' },
  { key: 'seguranca', label: 'Itens de segurança em ordem' },
];

// ------------------------------------------------ documentos

export type EntryKind = 'compra' | 'inicial' | 'devolucao_venda' | 'outra';
export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  compra: 'Compra',
  inicial: 'Implantação inicial',
  devolucao_venda: 'Devolução de venda',
  outra: 'Outra entrada autorizada',
};

export interface EntryItemInput {
  item_id: number;
  quantity: number;
  unit_cost: number; // centavos
  units?: { asset_tag: string | null; serial_number: string | null }[]; // itens individuais
}

export interface Entry {
  id: number;
  number: string;
  entry_kind: EntryKind;
  status: 'rascunho' | 'confirmada' | 'cancelada';
  supplier_id: number | null;
  supplier_name: string | null;
  origin_document: string | null;
  entry_date: string;
  location_id: number;
  location_name: string;
  received_by: string | null;
  discount: number;
  extra_expenses: number;
  items_total: number;
  total: number;
  notes: string | null;
  created_by_name: string;
  confirmed_at: string | null;
  created_at: string;
  items: (EntryItemInput & { id: number; item_code: string; item_description: string; tracking: Tracking; unit: string; line_total: number; allocated_unit_cost: number })[];
}

export type TransferStatus = 'rascunho' | 'aguardando_envio' | 'em_transito' | 'recebida' | 'cancelada';
export const TRANSFER_LABELS: Record<TransferStatus, string> = {
  rascunho: 'Rascunho',
  aguardando_envio: 'Aguardando envio',
  em_transito: 'Em trânsito',
  recebida: 'Recebida',
  cancelada: 'Cancelada',
};

export interface Transfer {
  id: number;
  number: string;
  status: TransferStatus;
  origin_location_id: number;
  origin_name: string;
  dest_location_id: number;
  dest_name: string;
  notes: string | null;
  sent_by_name: string | null;
  sent_at: string | null;
  received_by_name: string | null;
  received_at: string | null;
  divergence_notes: string | null;
  created_by_name: string;
  created_at: string;
  items: { id: number; item_id: number; item_code: string; item_description: string; unit: string; asset_id: number | null; asset_tag: string | null; quantity: number; received_quantity: number | null }[];
}

export type InventoryStatus = 'em_andamento' | 'aguardando_conferencia' | 'aguardando_aprovacao' | 'finalizado' | 'cancelado';
export const INVENTORY_LABELS: Record<InventoryStatus, string> = {
  em_andamento: 'Em andamento',
  aguardando_conferencia: 'Aguardando conferência',
  aguardando_aprovacao: 'Aguardando aprovação',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

export type InventoryScope = 'geral' | 'local' | 'categoria' | 'tipo' | 'itens';

export interface InventoryLine {
  id: number;
  item_id: number;
  item_code: string;
  item_description: string;
  unit: string;
  tracking: Tracking;
  location_id: number;
  location_name: string;
  system_qty: number;
  counted_qty: number | null;
  difference: number | null;
  justification: string | null;
  moved_since_snapshot: number; // movimentações confirmadas após a abertura
}

export interface Inventory {
  id: number;
  number: string;
  status: InventoryStatus;
  scope: InventoryScope;
  scope_label: string;
  location_id: number | null;
  location_name: string | null;
  opened_by_name: string;
  opened_at: string;
  checked_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  notes: string | null;
  lines: InventoryLine[];
}

export interface StockSettings {
  categories: { name: string; subcategories: string[] }[];
  units: { code: string; name: string }[];
  exit_reasons: string[];
  allow_negative_default: boolean;
}
