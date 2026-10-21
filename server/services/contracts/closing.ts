/**
 * Encerramento do contrato. O pagamento não encerra nada: a locação termina quando os equipamentos
 * voltam. Depois da última devolução (e da conferência dos patrimônios, se a empresa exige), o contrato
 * encerra sozinho; cobranças em aberto continuam no Financeiro para serem recebidas.
 */

import { DB } from '../../db';
import { AuthUser } from '../../../shared/orcamentos/types';
import { todayISO } from '../../../shared/orcamentos/dates';
import { cancelReservationTx, getReservation } from '../stock/rental';
import { NOW_SQL, getContractSettings, setStatus } from './core';
import { cancelFutureChargesTx, financialSummary, listCharges } from './billing';

const addDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
const brl = (v: number) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Patrimônios devolvidos pelo contrato que ainda aguardam conferência no Estoque. */
export function pendingInspections(db: DB, contractId: number): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT a.asset_tag FROM contract_operation_items oi JOIN contract_operations o ON o.id = oi.operation_id JOIN stock_assets a ON a.id = oi.asset_id
         WHERE o.contract_id = ? AND o.operation_type = 'devolucao' AND a.operational_status = 'aguardando_inspecao'
           AND NOT EXISTS (SELECT 1 FROM stock_reservations r WHERE r.asset_id = a.id AND r.status = 'em_uso')`
      )
      .all(contractId) as { asset_tag: string }[]
  ).map((r) => r.asset_tag);
}

/** Encerra o contrato (dentro de transação): cancela reservas futuras e cobranças de períodos não iniciados sem recebimento. */
export function closeContractTx(db: DB, user: AuthUser, c: any, auto = false) {
  for (const r of db.prepare("SELECT id FROM stock_reservations WHERE contract_id = ? AND status IN ('pendente','confirmada')").all(c.id) as { id: number }[])
    cancelReservationTx(db, user, getReservation(db, r.id), 'Contrato encerrado');
  const ch = cancelFutureChargesTx(db, user, c.id, addDay(todayISO()), `Encerramento do contrato ${c.contract_number}`);
  const summary = financialSummary(c, listCharges(db, c.id), []);
  setStatus(
    db,
    c,
    'encerrado',
    user,
    `${auto ? 'Contrato encerrado automaticamente: todos os equipamentos foram devolvidos.' : 'Contrato encerrado.'} Cobrado ${brl(summary.scheduled)}, recebido ${brl(summary.received)}, em aberto ${brl(summary.open)}${ch.cancelled ? `; ${ch.cancelled} cobrança(s) futura(s) cancelada(s)` : ''}.`,
    `closed_at = ${NOW_SQL}, closed_by = ?`,
    [user.id]
  );
  return { summary, cancelled_charges: ch.cancelled };
}

/**
 * Chamado após devolução e após conferência de patrimônio: encerra a locação quando não sobra nada com o
 * cliente nem nada a entregar. Pagamento e cobranças em aberto não interferem.
 */
export function autoCloseIfReturnedTx(db: DB, user: AuthUser, contractId: number | null | undefined): boolean {
  if (!contractId) return false;
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as any;
  if (!c || c.contract_type !== 'locacao' || !['ativo', 'vencido', 'pendente_devolucao'].includes(c.status)) return false;
  if (!db.prepare("SELECT 1 FROM contract_operations WHERE contract_id = ? AND operation_type = 'devolucao'").get(contractId)) return false;
  if (db.prepare("SELECT 1 FROM stock_reservations WHERE contract_id = ? AND status IN ('pendente','confirmada','em_uso')").get(contractId)) return false;
  if (getContractSettings(db).require_inspection_before_close && pendingInspections(db, contractId).length) return false;
  closeContractTx(db, user, c, true);
  return true;
}
