/**
 * Central Locação - Módulo Financeiro: tipos compartilhados.
 * Valores em CENTAVOS inteiros. Datas de negócio em YYYY-MM-DD.
 *
 * Estrutura (sem misturar situações):
 * - Título (financial_entries): a obrigação/cobrança — situação do cadastro (rascunho, aguardando aprovação, ativo, cancelado).
 * - Parcela (financial_installments): vencimento e situação de liquidação (aberto, parcial, liquidado, cancelado; "vencido" é derivado).
 * - Movimentação (financial_transactions): dinheiro que efetivamente entrou/saiu de uma conta (pendente, efetivada).
 * - Alocação (financial_allocations): quanto de cada movimentação quitou cada parcela.
 */

export type EntryType = 'pagar' | 'receber';
export type EntryStatus = 'rascunho' | 'aguardando_aprovacao' | 'ativo' | 'cancelado';
export type InstallmentStatus = 'aberto' | 'parcial' | 'liquidado' | 'cancelado';
/** Situação exibida (inclui "vencido", calculado pela data). */
export type DisplayStatus = 'rascunho' | 'aguardando_aprovacao' | 'aberto' | 'parcial' | 'liquidado' | 'vencido' | 'cancelado';

export const DISPLAY_LABELS: Record<EntryType, Record<DisplayStatus, string>> = {
  pagar: {
    rascunho: 'Rascunho',
    aguardando_aprovacao: 'Aguardando aprovação',
    aberto: 'Em aberto',
    parcial: 'Parcialmente pago',
    liquidado: 'Pago',
    vencido: 'Vencido',
    cancelado: 'Cancelado',
  },
  receber: {
    rascunho: 'Rascunho',
    aguardando_aprovacao: 'Aguardando aprovação',
    aberto: 'Em aberto',
    parcial: 'Parcialmente recebido',
    liquidado: 'Recebido',
    vencido: 'Vencido',
    cancelado: 'Cancelado',
  },
};

export type PartyType = 'fornecedor' | 'cliente' | 'outro';

export type SourceType = 'manual' | 'venda' | 'contrato' | 'entrada_estoque' | 'recorrencia' | 'extrato';
export const SOURCE_LABELS: Record<SourceType, string> = {
  manual: 'Lançamento manual',
  venda: 'Venda (orçamento convertido)',
  contrato: 'Contrato de locação',
  entrada_estoque: 'Entrada de estoque (compra)',
  recorrencia: 'Recorrência',
  extrato: 'Criado na conciliação',
};

/** Origem da cobrança (contas a receber). */
export type ReceivableOrigin = 'venda' | 'locacao' | 'servico' | 'cobranca_adicional' | 'multa_contratual' | 'outras';
export const ORIGIN_LABELS: Record<ReceivableOrigin, string> = {
  venda: 'Venda de equipamento',
  locacao: 'Locação de equipamento',
  servico: 'Serviço',
  cobranca_adicional: 'Cobrança adicional',
  multa_contratual: 'Multa contratual',
  outras: 'Outras receitas autorizadas',
};

export type CategoryType = 'receita' | 'despesa';

/** Grupo da DRE gerencial. "investimento" (compra de patrimônio) fica FORA do resultado. */
export type DreGroup =
  | 'receita_venda'
  | 'receita_locacao'
  | 'receita_servico'
  | 'outras_receitas'
  | 'receita_financeira'
  | 'custo_operacional'
  | 'compra_estoque'
  | 'despesa_operacional'
  | 'despesa_administrativa'
  | 'despesa_financeira'
  | 'investimento';

export const DRE_LABELS: Record<DreGroup, string> = {
  receita_venda: 'Receitas de vendas',
  receita_locacao: 'Receitas de locação',
  receita_servico: 'Receitas de serviços',
  outras_receitas: 'Outras receitas',
  receita_financeira: 'Receitas financeiras',
  custo_operacional: 'Custos das operações',
  compra_estoque: 'Custos com compras para estoque',
  despesa_operacional: 'Despesas operacionais',
  despesa_administrativa: 'Despesas administrativas',
  despesa_financeira: 'Despesas financeiras',
  investimento: 'Investimentos em patrimônio (fora do resultado)',
};

export const DRE_GROUPS_BY_TYPE: Record<CategoryType, DreGroup[]> = {
  receita: ['receita_venda', 'receita_locacao', 'receita_servico', 'outras_receitas', 'receita_financeira'],
  despesa: ['custo_operacional', 'compra_estoque', 'despesa_operacional', 'despesa_administrativa', 'despesa_financeira', 'investimento'],
};

export interface FinancialCategory {
  id: number;
  name: string;
  category_type: CategoryType;
  parent_id: number | null;
  dre_group: DreGroup;
  active: boolean;
}

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
}

export type AccountType = 'caixa' | 'corrente' | 'poupanca' | 'outra';
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  caixa: 'Caixa físico',
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  outra: 'Outra',
};

export interface FinancialAccount {
  id: number;
  name: string;
  account_type: AccountType;
  institution_name: string | null;
  account_reference: string | null;
  opening_balance: number;
  opening_balance_date: string;
  responsible: string | null;
  notes: string | null;
  active: boolean;
  balance: number; // saldo oficial: inicial + movimentações efetivadas
  reconciled_balance: number; // inicial + movimentações conciliadas (informativo)
  pending_transfers: number;
}

export interface Installment {
  id: number;
  entry_id: number;
  number: number;
  due_date: string;
  original_amount: number;
  discount: number;
  interest: number;
  penalty: number;
  additional: number;
  updated_amount: number;
  settled_amount: number;
  pending_amount: number;
  status: InstallmentStatus;
  display_status: DisplayStatus;
  days_overdue: number;
  row_version: number;
}

export interface CostCenterAllocation {
  cost_center_id: number;
  cost_center_name?: string;
  amount: number;
}

export interface Entry {
  id: number;
  entry_number: string;
  entry_type: EntryType;
  status: EntryStatus;
  display_status: DisplayStatus;
  description: string;
  party_type: PartyType;
  supplier_id: number | null;
  customer_id: number | null;
  party_name: string;
  party_document: string | null;
  category_id: number;
  category_name: string;
  dre_group: DreGroup;
  origin: ReceivableOrigin | null;
  source_type: SourceType;
  source_id: string | null;
  source_ref: string | null;
  quotation_id: number | null;
  document_ref: string | null;
  issue_date: string;
  competence_date: string;
  original_amount: number;
  updated_amount: number;
  settled_amount: number;
  pending_amount: number;
  next_due_date: string | null;
  installments_count: number;
  payment_method: string | null;
  planned_account_id: number | null;
  planned_account_name: string | null;
  recurrence_id: number | null;
  notes: string | null;
  cancel_reason: string | null;
  created_by_name: string;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface EntryDetail extends Entry {
  installments: Installment[];
  cost_centers: CostCenterAllocation[];
  payments: PaymentRow[];
  attachments: Attachment[];
  history: { id: number; action: string; data: string | null; user_name: string; created_at: string }[];
  allowed: { edit: boolean; approve: boolean; settle: boolean; cancel: boolean; reverse: boolean };
}

export interface PaymentRow {
  allocation_id: number;
  transaction_id: number;
  transaction_number: string;
  installment_number: number;
  amount: number;
  transaction_date: string;
  account_name: string;
  method: string | null;
  reversed: boolean;
  is_reversal: boolean;
  performed_by_name: string;
  created_at: string;
}

export type TransactionType =
  | 'recebimento'
  | 'pagamento'
  | 'transferencia_saida'
  | 'transferencia_entrada'
  | 'ajuste_caixa'
  | 'estorno';

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  recebimento: 'Recebimento',
  pagamento: 'Pagamento',
  transferencia_saida: 'Transferência enviada',
  transferencia_entrada: 'Transferência recebida',
  ajuste_caixa: 'Ajuste de fechamento de caixa',
  estorno: 'Estorno',
};

export interface Transaction {
  id: number;
  transaction_number: string;
  account_id: number;
  account_name: string;
  transaction_type: TransactionType;
  direction: 1 | -1;
  amount: number;
  transaction_date: string;
  description: string;
  method: string | null;
  source_type: string | null;
  source_id: string | null;
  status: 'pendente' | 'efetivada';
  reversal_of_id: number | null;
  reversed_by_id: number | null;
  reconciled: boolean;
  statement_item_id: number | null;
  balance_after: number | null;
  performed_by_name: string;
  created_at: string;
}

export interface Attachment {
  id: number;
  name: string;
  mime: string;
  size: number;
  uploaded_by_name: string;
  created_at: string;
}

export type TransferStatus = 'pendente' | 'efetivada' | 'estornada' | 'cancelada';
export const TRANSFER_LABELS: Record<TransferStatus, string> = {
  pendente: 'Pendente de efetivação',
  efetivada: 'Efetivada',
  estornada: 'Estornada',
  cancelada: 'Cancelada',
};

export interface Transfer {
  id: number;
  number: string;
  source_account_id: number;
  source_name: string;
  destination_account_id: number;
  destination_name: string;
  amount: number;
  transfer_date: string;
  status: TransferStatus;
  description: string | null;
  reference: string | null;
  performed_by_name: string;
  confirmed_by_name: string | null;
  created_at: string;
}

export type StatementStatus = 'pendente' | 'conciliado' | 'divergente' | 'ignorado' | 'duplicado';
export const STATEMENT_LABELS: Record<StatementStatus, string> = {
  pendente: 'Não conciliado',
  conciliado: 'Conciliado',
  divergente: 'Divergente',
  ignorado: 'Ignorado',
  duplicado: 'Duplicado',
};

export interface StatementItem {
  id: number;
  reconciliation_id: number;
  account_id: number;
  transaction_date: string;
  description: string;
  amount: number; // com sinal: + crédito, − débito
  external_reference: string | null;
  status: StatementStatus;
  matched_transaction_id: number | null;
  matched_transaction_number: string | null;
  note: string | null;
  suggestions?: { transaction_id: number; transaction_number: string; transaction_date: string; description: string; amount: number; score: number }[];
}

export interface CashSession {
  id: number;
  account_id: number;
  account_name: string;
  status: 'aberto' | 'fechado';
  opened_by_name: string;
  opened_at: string;
  opening_balance: number;
  inflows: number;
  outflows: number;
  expected_balance: number;
  counted_amount: number | null;
  difference: number | null;
  justification: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
}

export type RecurrenceFrequency = 'semanal' | 'mensal' | 'anual';

export interface Recurrence {
  id: number;
  entry_type: EntryType;
  description: string;
  amount: number;
  frequency: RecurrenceFrequency;
  start_date: string;
  end_date: string | null;
  next_date: string;
  active: boolean;
  party_name: string;
  category_name: string;
  generated: number;
}

export interface FinanceSettings {
  default_receivable_days: number;
  payment_approval_limit: number; // centavos; 0 = sem aprovação
  allow_negative_balance: boolean;
  auto_reconcile_exact: boolean;
  recurrence_horizon_days: number;
  sale_category_id: number | null;
  rental_category_id: number | null;
}
