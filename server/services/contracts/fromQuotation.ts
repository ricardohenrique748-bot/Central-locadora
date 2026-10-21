/**
 * Adaptador de conversão "contrato_locacao" (server/integrations.ts): orçamento de locação aprovado pelo
 * cliente → contrato em RASCUNHO. Roda dentro da transação idempotente de convertQuotation: o mesmo
 * orçamento nunca gera dois contratos (quotation_id é único em contracts).
 * Nada é reservado nem cobrado aqui: o contrato ainda passa por aprovação, assinatura e ativação.
 */

import { DB } from '../../db';
import { HttpError } from '../../http';
import { AuthUser, Quotation } from '../../../shared/orcamentos/types';
import { BillingFrequency } from '../../../shared/contratos/types';
import { getContractSettings, insertContractTx, normalizeContract } from './core';

export function contractFromQuotation(db: DB, q: Quotation, user: AuthUser | null): { record_id: string } {
  if (!user) throw new HttpError(422, 'Conversão exige usuário identificado.');
  if (q.quotation_type !== 'locacao') throw new HttpError(422, 'Somente orçamentos de locação geram contrato de locação.');
  const dup = db.prepare('SELECT contract_number FROM contracts WHERE quotation_id = ?').get(q.id) as { contract_number: string } | undefined;
  if (dup) return { record_id: dup.contract_number };
  if (!q.start_date || !q.end_date) throw new HttpError(422, 'O orçamento precisa ter período de locação (início e término) para gerar o contrato.');
  const noCatalog = q.items.filter((i) => !i.catalog_item_id);
  if (noCatalog.length) throw new HttpError(422, `Itens sem cadastro no Estoque não entram em contrato: ${noCatalog.map((i) => i.description_snapshot).join(', ')}. Ajuste o orçamento.`);

  const freqMap: Record<string, BillingFrequency> = { diaria: 'diaria', semanal: 'semanal', mensal: 'mensal', personalizado: 'personalizado' };
  const billing = freqMap[q.rental_billing_period || 'mensal'] || 'mensal';
  const periods = Math.max(1, q.items[0]?.periods || 1);
  const items: any[] = [];
  for (const it of q.items) {
    const cat = db.prepare('SELECT tracking, rental_enabled, sale_enabled FROM catalog_items WHERE id = ?').get(it.catalog_item_id) as any;
    const perPeriodDiscount = Math.round(it.discount_amount / Math.max(1, it.periods || periods));
    if (cat?.tracking === 'individual') {
      // um item por unidade: o patrimônio é escolhido no contrato antes da reserva
      const units = Math.max(1, Math.round(it.quantity));
      for (let u = 0; u < units; u++) items.push({ item_id: it.catalog_item_id, asset_id: null, quantity: 1, modality: 'locacao', unit_price: it.unit_price, discount_amount: Math.round(perPeriodDiscount / units), notes: it.notes });
    } else items.push({ item_id: it.catalog_item_id, quantity: it.quantity, modality: cat?.rental_enabled ? 'locacao' : 'venda', unit_price: it.unit_price, discount_amount: perPeriodDiscount, notes: it.notes });
  }
  const custom = billing === 'personalizado' && q.rental_days && q.custom_periods ? Math.max(1, Math.round(q.rental_days / q.custom_periods)) : null;
  let input;
  try {
    input = normalizeContract(db, {
      contract_type: 'locacao',
      customer_id: q.customer_id,
      start_date: q.start_date,
      end_date: q.end_date,
      responsible_user_id: q.responsible_user_id,
      billing_frequency: billing,
      custom_period_days: custom,
      billing_timing: 'antecipado',
      due_days_after: getContractSettings(db).default_due_days_after,
      proportional_last: true,
      single_charge: true, // período do orçamento cobrado de uma vez: uma cobrança com o valor total
      general_discount: Math.round((q.general_discount || 0) / periods),
      freight_delivery: q.freight_amount,
      freight_pickup: q.pickup_freight_amount,
      other_fees: (q.installation_amount || 0) + (q.other_services_amount || 0) + (q.additional_charges || 0),
      other_fees_description: q.installation_amount ? 'Instalação e serviços' : 'Taxas e serviços adicionais',
      deposit_amount: q.deposit_amount,
      payment_terms: q.payment_terms,
      special_conditions: [q.specific_conditions, q.return_conditions && `Devolução: ${q.return_conditions}`, q.customer_responsibilities && `Responsabilidades do cliente: ${q.customer_responsibilities}`, q.included_accessories && `Acessórios: ${q.included_accessories}`]
        .filter(Boolean)
        .join('\n'),
      delivery_address: q.pickup_delivery_terms,
      internal_notes: `Gerado do orçamento ${q.quotation_number} (versão ${q.version}).${q.internal_notes ? `\n${q.internal_notes}` : ''}`,
      items,
    });
  } catch (e: any) {
    const detail = e?.fields ? Object.values(e.fields).join(' ') : e?.message;
    throw new HttpError(422, `Não foi possível gerar o contrato a partir do orçamento: ${detail}`);
  }
  const id = insertContractTx(db, user, input, { source: 'orcamento', quotation_id: q.id });
  return { record_id: (db.prepare('SELECT contract_number FROM contracts WHERE id = ?').get(id) as { contract_number: string }).contract_number };
}
