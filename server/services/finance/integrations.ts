/**
 * Integrações do Financeiro com Orçamentos/Vendas, Estoque e (futuramente) Contratos.
 *
 * - Orçamento aprovado NÃO gera cobrança. A cobrança nasce quando a venda é efetivada (conversão).
 * - Cada origem gera no máximo um título: índice único (source_type, source_id).
 * - Pagamentos já realizados nunca são alterados por mudanças na origem.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser, Quotation } from '../../../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../../../shared/orcamentos/dates';
import { financeCan, addMonthsISO } from '../../../shared/financeiro/rules';
import { round3 } from '../../../shared/estoque/rules';
import { applyMovement } from '../stock/core';
import { NOW_SQL } from './core';
import { getEntryDetail, insertEntry, normalizeEntry } from './entries';
import { getFinanceSettings } from './registry';

// ================================================ VENDAS (conversão do orçamento)

/**
 * Efetiva a venda de um orçamento aprovado: baixa o estoque dos produtos por quantidade e gera a conta a receber.
 * Roda DENTRO da transação da conversão (services/quotations.ts), que já garante idempotência.
 */
export function convertSale(db: DB, q: Quotation, user: AuthUser | null): { record_id: string } {
  if (q.quotation_type !== 'venda') throw badRequest('Somente orçamentos de venda geram venda.');
  if (q.total_amount <= 0) throw new HttpError(422, 'Venda sem valor não gera cobrança.');
  const s = getFinanceSettings(db);
  if (!s.sale_category_id) throw new HttpError(422, 'Configure a categoria financeira padrão de vendas em Financeiro › Configurações.');

  // 1) estoque: produtos controlados por quantidade saem do local padrão (ou do local com saldo)
  for (const it of q.items) {
    if (!it.catalog_item_id) continue; // item avulso / serviço: sem estoque
    const item = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(it.catalog_item_id) as any;
    if (!item) continue;
    if (item.tracking === 'individual') {
      throw new HttpError(422, `${item.internal_code} é controlado por patrimônio: registre a baixa da unidade vendida na ficha do equipamento e converta a venda sem esse item.`);
    }
    // na manutenção a peça é consumida no conserto: baixa mesmo que não seja vendida avulsa
    if (['peca', 'consumo'].includes(item.kind) && !item.sale_enabled && q.category !== 'manutencao') continue;
    const locs = db.prepare('SELECT location_id, quantity - reserved - unavailable AS free FROM stock_balances WHERE item_id = ? ORDER BY (location_id = ?) DESC, free DESC').all(item.id, item.default_location_id ?? 0) as { location_id: number; free: number }[];
    const loc = locs.find((l) => l.free + 1e-9 >= it.quantity);
    if (!loc && !item.allow_negative) {
      const total = round3(locs.reduce((a, l) => a + Math.max(0, l.free), 0));
      throw new HttpError(422, `Estoque insuficiente de ${item.internal_code}: necessário ${it.quantity}, disponível ${total} (em um único local). Faça uma transferência ou entrada antes de converter.`);
    }
    const locationId = loc?.location_id ?? item.default_location_id ?? locs[0]?.location_id;
    if (!locationId) throw new HttpError(422, `${item.internal_code} não tem local de estoque definido.`);
    applyMovement(db, user, {
      type: 'saida_venda', item_id: item.id, quantity: it.quantity, location_id: locationId, qty_delta: -it.quantity,
      origin_location_id: locationId, reference_doc: q.quotation_number, reason: `${q.category === 'manutencao' ? 'Manutenção para' : 'Venda a'} ${q.customer_snapshot.name}`, document_type: 'venda', document_id: q.id,
    });
  }

  // 2) financeiro: conta a receber vinculada ao orçamento (índice único por origem)
  const e = normalizeEntry(
    db,
    {
      description: q.category === 'manutencao' ? `Manutenção ${q.quotation_number}${q.equipment_info?.description ? ` — ${q.equipment_info.description}` : ''}` : `Venda ${q.quotation_number}`,
      party_type: 'cliente',
      customer_id: q.customer_id,
      category_id: s.sale_category_id,
      origin: 'venda',
      document_ref: q.client_reference,
      issue_date: todayISO(),
      competence_date: todayISO(),
      payment_method: q.payment_terms ? q.payment_terms.slice(0, 40) : null,
      notes: q.payment_terms ? `Condições: ${q.payment_terms}` : null,
      plan: { total: q.total_amount, count: 1, first_due: addDaysISO(todayISO(), s.default_receivable_days) },
      source_type: 'venda',
      source_id: String(q.id),
      source_ref: q.quotation_number,
      quotation_id: q.id,
    },
    'receber'
  );
  const entryId = insertEntry(db, user, e);
  const num = (db.prepare('SELECT entry_number FROM financial_entries WHERE id = ?').get(entryId) as { entry_number: string }).entry_number;
  return { record_id: num };
}

// ================================================ ESTOQUE (entrada de compra → conta a pagar)

export function payableFromStockEntry(db: DB, user: AuthUser, stockEntryId: number, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const id = transaction(db, () => {
    const se = db.prepare('SELECT * FROM stock_entries WHERE id = ?').get(stockEntryId) as any;
    if (!se) throw notFound('Entrada de estoque não encontrada.');
    if (se.status !== 'confirmada') throw new HttpError(422, 'Somente entradas confirmadas geram obrigação financeira.');
    if (se.entry_kind !== 'compra') throw new HttpError(422, 'Somente entradas do tipo compra geram conta a pagar.');
    if (!se.supplier_id) throw new HttpError(422, 'A entrada não tem fornecedor.');
    if (se.total <= 0) throw new HttpError(422, 'Entrada sem valor.');
    const dup = db.prepare("SELECT entry_number FROM financial_entries WHERE source_type = 'entrada_estoque' AND source_id = ?").get(String(se.id)) as any;
    if (dup) throw conflict(`Esta entrada já gerou a conta a pagar ${dup.entry_number}.`);
    const e = normalizeEntry(
      db,
      {
        ...raw,
        description: raw?.description || `Compra ${se.number}${se.origin_document ? ` — ${se.origin_document}` : ''}`,
        party_type: 'fornecedor',
        supplier_id: se.supplier_id,
        document_ref: se.origin_document,
        issue_date: se.entry_date,
        competence_date: raw?.competence_date || se.entry_date,
        original_amount: se.total,
        plan: { ...(raw?.plan || {}), total: se.total, count: raw?.plan?.count || 1, first_due: raw?.plan?.first_due || addDaysISO(todayISO(), 30) },
        source_type: 'entrada_estoque',
        source_id: String(se.id),
        source_ref: se.number,
      },
      'pagar'
    );
    return insertEntry(db, user, e);
  });
  return getEntryDetail(db, user, id);
}

/** Entradas de compra confirmadas que ainda não geraram conta a pagar. */
export function stockEntriesWithoutPayable(db: DB) {
  return {
    rows: db
      .prepare(
        `SELECT se.id, se.number, se.entry_date, se.total, se.origin_document, s.name AS supplier_name
         FROM stock_entries se JOIN suppliers s ON s.id = se.supplier_id
         WHERE se.status = 'confirmada' AND se.entry_kind = 'compra' AND se.total > 0
           AND NOT EXISTS (SELECT 1 FROM financial_entries f WHERE f.source_type = 'entrada_estoque' AND f.source_id = CAST(se.id AS TEXT))
         ORDER BY se.id DESC LIMIT 100`
      )
      .all(),
  };
}

export function financialLinkForStockEntry(db: DB, stockEntryId: number) {
  return db.prepare("SELECT id, entry_number, status FROM financial_entries WHERE source_type = 'entrada_estoque' AND source_id = ?").get(String(stockEntryId)) || null;
}

// ================================================ CONTRATOS

/**
 * Cada cobrança do cronograma do contrato vira UMA conta a receber, com origem "contrato:<id>:<cobrança>".
 * O índice único de origem impede duplicidade mesmo se o contrato for reprocessado.
 * Estas funções rodam DENTRO da transação do módulo de Contratos.
 */
export interface ContractChargeEntry {
  contract_id: number;
  charge_id: number;
  contract_number: string;
  customer_id: number;
  description: string;
  amount: number;
  due_date: string;
  competence_date: string;
  category_id: number | null;
  origin: 'locacao' | 'venda' | 'cobranca_adicional';
  notes?: string | null;
}

export const contractSourceId = (contractId: number, chargeId: number) => `${contractId}:${chargeId}`;

export function contractChargeEntryTx(db: DB, user: AuthUser | null, c: ContractChargeEntry): number {
  const source_id = contractSourceId(c.contract_id, c.charge_id);
  const dup = db.prepare("SELECT id FROM financial_entries WHERE source_type = 'contrato' AND source_id = ?").get(source_id) as { id: number } | undefined;
  if (dup) return dup.id;
  const s = getFinanceSettings(db);
  const category = c.category_id || (c.origin === 'venda' ? s.sale_category_id : s.rental_category_id);
  if (!category) throw new HttpError(422, `Configure a categoria financeira padrão de ${c.origin === 'venda' ? 'vendas' : 'locação'} em Financeiro › Configurações.`);
  if (!Number.isInteger(c.amount) || c.amount <= 0) throw badRequest('Valor da cobrança inválido.');
  const e = normalizeEntry(
    db,
    {
      description: `${c.description} — contrato ${c.contract_number}`.slice(0, 200),
      party_type: 'cliente',
      customer_id: c.customer_id,
      category_id: category,
      origin: c.origin,
      document_ref: c.contract_number,
      issue_date: todayISO(),
      competence_date: c.competence_date,
      notes: c.notes ?? null,
      plan: { total: c.amount, count: 1, first_due: c.due_date },
      source_type: 'contrato',
      source_id,
      source_ref: c.contract_number,
    },
    'receber'
  );
  return insertEntry(db, user, e);
}

/** Situação do título de uma cobrança: o Financeiro é a fonte oficial do recebimento. */
export function contractChargeState(db: DB, entryId: number) {
  return db
    .prepare(
      `SELECT e.entry_number, e.status AS entry_status, i.id AS installment_id, i.status, i.due_date, i.settled_amount,
         i.original_amount - i.discount + i.interest + i.penalty + i.additional AS updated
       FROM financial_entries e JOIN financial_installments i ON i.entry_id = e.id WHERE e.id = ? ORDER BY i.number LIMIT 1`
    )
    .get(entryId) as { entry_number: string; entry_status: string; installment_id: number; status: string; due_date: string; settled_amount: number; updated: number } | undefined;
}

/** Ajuste/crédito autorizado de uma cobrança ainda sem recebimento (com motivo e auditoria). */
export function adjustContractChargeTx(db: DB, user: AuthUser, entryId: number, newAmount: number, reason: string) {
  if (!Number.isInteger(newAmount) || newAmount <= 0) throw badRequest('Novo valor inválido.');
  const st = contractChargeState(db, entryId);
  if (!st) throw notFound('Título da cobrança não encontrado.');
  if (st.settled_amount > 0 || st.status !== 'aberto') throw new HttpError(422, `${st.entry_number} já tem recebimento registrado e não é alterado.`);
  db.prepare(`UPDATE financial_installments SET original_amount = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(newAmount, st.installment_id);
  db.prepare(`UPDATE financial_entries SET original_amount = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(newAmount, entryId);
  audit(db, 'financial_entry', entryId, 'ajuste_contrato', user.id, { de: st.updated, para: newAmount, reason });
}

/** Cancela o título de uma cobrança sem recebimento. Cobrança com recebimento é mantida (estornar no Financeiro). */
export function cancelContractChargeTx(db: DB, user: AuthUser | null, entryId: number, reason: string) {
  const st = contractChargeState(db, entryId);
  if (!st) throw notFound('Título da cobrança não encontrado.');
  if (st.entry_status === 'cancelado') return;
  if (st.settled_amount > 0) throw new HttpError(422, `${st.entry_number} já tem recebimento registrado: estorne no Financeiro antes de cancelar.`);
  db.prepare(`UPDATE financial_entries SET status = 'cancelado', cancel_reason = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(reason, entryId);
  db.prepare(`UPDATE financial_installments SET status = 'cancelado', updated_at = ${NOW_SQL} WHERE entry_id = ?`).run(entryId);
  audit(db, 'financial_entry', entryId, 'cancelamento_contrato', user?.id ?? null, { reason });
}

/** Histórico financeiro de uma venda (orçamento) ou contrato. */
export function financialHistory(db: DB, sourceType: 'venda' | 'contrato', sourceId: string) {
  const entries = db.prepare('SELECT id, entry_number, status, original_amount, created_at FROM financial_entries WHERE source_type = ? AND (source_id = ? OR source_id LIKE ?)').all(sourceType, sourceId, `${sourceId}:%`) as any[];
  return entries.map((e) => {
    const inst = db.prepare('SELECT number, due_date, original_amount - discount + interest + penalty + additional AS updated, settled_amount, status FROM financial_installments WHERE entry_id = ? ORDER BY number').all(e.id);
    return { ...e, installments: inst };
  });
}
