/**
 * Boletim de medição de uma cobrança de locação (PDF gerado na hora, sem valor fiscal).
 * Mede, por item, a quantidade em poder do cliente dia a dia no período cobrado, a partir das
 * entregas e devoluções registradas no contrato. O valor faturado é o da cobrança (o mesmo da fatura).
 */

import PDFDocument from 'pdfkit';
import { DB, audit } from '../../db';
import { HttpError, forbidden, notFound } from '../../http';
import { drawLogo } from '../../pdfLogo';
import { getSettings } from '../../settings';
import { AuthUser } from '../../../shared/orcamentos/types';
import { contractCan, measurePeriod } from '../../../shared/contratos/rules';
import { formatBRL, formatNumber } from '../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../shared/orcamentos/dates';
import { formatDocument } from '../../../shared/orcamentos/validators';
import { contractChargeState } from '../finance/integrations';

const BLUE = '#1e3a5f';
const GRAY = '#4b5563';
const LIGHT = '#eef2f7';
const BORDER = '#cbd5e1';
const t = (v: unknown) => String(v ?? '').replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[^\S\n]+/g, ' ');

/** Cobranças que têm medição: período de locação ou valor único de contrato de locação. */
export const MEASURABLE_KINDS = ['periodo', 'unico'];

export function chargeMeasurement(db: DB, user: AuthUser, contractId: number, chargeId: number) {
  if (!contractCan.view(user) || !contractCan.viewFinance(user)) throw forbidden('Seu perfil não acessa os valores financeiros do contrato.');
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as any;
  if (!c) throw notFound('Contrato não encontrado.');
  const ch = db.prepare('SELECT * FROM contract_charges WHERE id = ? AND contract_id = ?').get(chargeId, contractId) as any;
  if (!ch) throw notFound('Cobrança não encontrada.');
  if (ch.status === 'cancelado') throw notFound('Cobrança cancelada: não há medição.');
  if (c.contract_type !== 'locacao' || !MEASURABLE_KINDS.includes(ch.kind)) throw new HttpError(422, 'Medição só existe para cobranças de período de locação.');
  const st = ch.financial_entry_id ? contractChargeState(db, ch.financial_entry_id) : undefined;
  const seq = (db.prepare(`SELECT COUNT(*) n FROM contract_charges WHERE contract_id = ? AND status != 'cancelado' AND kind IN ('periodo','unico') AND (period_start < ? OR (period_start = ? AND id <= ?))`).get(contractId, ch.period_start, ch.period_start, chargeId) as { n: number }).n;

  const items = db.prepare("SELECT * FROM contract_items WHERE contract_id = ? AND modality = 'locacao' ORDER BY position").all(contractId) as any[];
  const ops = db
    .prepare(
      `SELECT o.number, o.operation_type, substr(o.performed_at, 1, 10) AS date, oi.contract_item_id, oi.quantity
       FROM contract_operation_items oi JOIN contract_operations o ON o.id = oi.operation_id WHERE o.contract_id = ? ORDER BY o.performed_at, o.id`
    )
    .all(contractId) as { number: string; operation_type: 'entrega' | 'devolucao'; date: string; contract_item_id: number; quantity: number }[];

  const lines = items.map((it) => {
    const moves = ops.filter((o) => o.contract_item_id === it.id).map((o) => ({ date: o.date, qty: o.operation_type === 'entrega' ? o.quantity : -o.quantity }));
    return {
      item_id: it.id,
      code: it.item_code_snapshot as string,
      description: it.description_snapshot as string,
      unit: it.unit as string,
      contracted_qty: it.quantity as number,
      period_value: (it.line_total - (it.discount_amount || 0)) as number,
      ...measurePeriod(ch.period_start, ch.period_end, moves),
    };
  });
  const itemName = new Map(items.map((it) => [it.id, `${it.item_code_snapshot} - ${it.description_snapshot}`]));
  const movements = ops
    .filter((o) => o.date >= ch.period_start && o.date <= ch.period_end && itemName.has(o.contract_item_id))
    .map((o) => ({ date: o.date, number: o.number, type: o.operation_type, item: itemName.get(o.contract_item_id)!, quantity: o.quantity }));

  return {
    number: `${c.contract_number}-M${String(seq).padStart(2, '0')}`,
    contract: c,
    charge: ch,
    entry_number: st?.entry_number || null,
    amount: st?.updated ?? ch.amount,
    lines,
    movements,
  };
}

export async function chargeMeasurementPdf(db: DB, user: AuthUser, contractId: number, chargeId: number): Promise<{ buffer: Buffer; name: string }> {
  const m = chargeMeasurement(db, user, contractId, chargeId);
  const { contract: c, charge: ch } = m;
  const company = getSettings(db).company;
  const cs = JSON.parse(c.customer_snapshot || '{}');

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, info: { Title: `Medição ${m.number}`, Author: company.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;

    // cabeçalho
    const logoW = drawLogo(doc, company, L, 40, [80, 49]);
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13).text(t(company.name), L + logoW, 40, { width: W * 0.55 - logoW });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY);
    for (const line of [company.legal_name, company.document && `CNPJ ${company.document}`, company.address, [company.phone, company.email].filter(Boolean).join(' • ')]) if (line) doc.text(t(line), { width: W * 0.55 - logoW });
    const hb = Math.max(doc.y, logoW ? 89 : 0);
    const bx = L + W * 0.58;
    const bw = W * 0.42;
    doc.roundedRect(bx, 40, bw, 70, 4).fill(BLUE);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('BOLETIM DE MEDIÇÃO', bx + 10, 48, { width: bw - 20 });
    doc.fontSize(14).text(t(m.number), { width: bw - 20 });
    doc.font('Helvetica').fontSize(8).text(t(`Emissão: ${formatDateBR(new Date().toISOString())}   •   Contrato ${c.contract_number}`), { width: bw - 20 });
    doc.font('Helvetica-Bold').text(t(`Período: ${formatDateBR(ch.period_start)} a ${formatDateBR(ch.period_end)}`), { width: bw - 20 });
    doc.y = Math.max(hb, 116) + 6;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1).strokeColor(BLUE).stroke();
    doc.moveDown(0.6);

    const section = (title: string) => {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLUE).text(t(title), L, doc.y, { width: W });
      doc.moveDown(0.2);
    };
    const kv = (pairs: [string, string | null | undefined][]) => {
      doc.font('Helvetica').fontSize(8.5).fillColor('#111827');
      for (const [k, v] of pairs) if (v) doc.font('Helvetica-Bold').text(t(`${k}: `), L, doc.y, { continued: true }).font('Helvetica').text(t(v), { width: W });
    };
    const table = (cols: { h: string; w: number; a: 'left' | 'right' | 'center' }[]) => (vals: string[], opts: { bold?: boolean; fill?: string } = {}) => {
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(t(v), { width: cols[i].w * W - 6 }))) + 7;
      if (doc.y + h > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      if (opts.fill) doc.rect(L, y, W, h).fill(opts.fill);
      let x = L;
      vals.forEach((v, i) => {
        doc.fillColor('#111827').text(t(v), x + 3, y + 3.5, { width: cols[i].w * W - 6, align: cols[i].a });
        x += cols[i].w * W;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(BORDER).stroke();
      doc.y = y + h;
    };

    section('CLIENTE');
    kv([
      ['Nome / Razão social', cs.name],
      [cs.person_type === 'PF' ? 'CPF' : 'CNPJ', cs.document ? formatDocument(cs.document) : null],
      ['Local da obra / entrega', c.delivery_address],
    ]);
    section('REFERÊNCIA');
    kv([
      ['Contrato', c.contract_number],
      ['Cobrança', ch.description],
      ['Fatura', m.entry_number],
      ['Dias no período', String(m.lines[0]?.period_days ?? '')],
    ]);

    section('MEDIÇÃO DOS EQUIPAMENTOS');
    const cols = [
      { h: 'Código', w: 0.1, a: 'left' as const },
      { h: 'Descrição', w: 0.3, a: 'left' as const },
      { h: 'Qtd. contr.', w: 0.09, a: 'right' as const },
      { h: 'Entregue', w: 0.08, a: 'right' as const },
      { h: 'Devolvido', w: 0.09, a: 'right' as const },
      { h: 'Dias em uso', w: 0.09, a: 'right' as const },
      { h: 'Diárias (unid. x dia)', w: 0.11, a: 'right' as const },
      { h: 'Valor do período', w: 0.14, a: 'right' as const },
    ];
    const row = table(cols);
    row(cols.map((x) => x.h), { bold: true, fill: LIGHT });
    let listed = 0;
    for (const l of m.lines) {
      row([l.code, l.description, `${formatNumber(l.contracted_qty)} ${l.unit}`, l.delivered ? formatNumber(l.delivered) : '-', l.returned ? formatNumber(l.returned) : '-', `${l.days_in_use}/${l.period_days}`, formatNumber(l.unit_days), formatBRL(l.period_value)]);
      listed += l.period_value;
    }
    if (listed !== m.amount) row(['', m.amount < listed ? 'Ajuste do período (proporcional/desconto)' : 'Acréscimos do período', '', '', '', '', '', formatBRL(m.amount - listed)]);

    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BLUE);
    const ty = doc.y;
    doc.text('Valor da medição', L + W * 0.45, ty, { width: W * 0.35, align: 'right' });
    doc.text(t(formatBRL(m.amount)), L + W * 0.8, ty, { width: W * 0.2, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(
      'Dias em uso: dias do período com ao menos uma unidade em poder do cliente. Diárias: soma, dia a dia, das unidades em poder do cliente. O dia da entrega conta; o da devolução não.',
      L, doc.y + 4, { width: W }
    );

    section('ENTREGAS E DEVOLUÇÕES NO PERÍODO');
    if (!m.movements.length) doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text('Nenhuma movimentação no período: os equipamentos permaneceram com o cliente (ou ainda não foram entregues).', L, doc.y, { width: W });
    else {
      const mcols = [
        { h: 'Data', w: 0.14, a: 'left' as const },
        { h: 'Documento', w: 0.16, a: 'left' as const },
        { h: 'Operação', w: 0.14, a: 'left' as const },
        { h: 'Equipamento', w: 0.44, a: 'left' as const },
        { h: 'Qtd.', w: 0.12, a: 'right' as const },
      ];
      const mrow = table(mcols);
      mrow(mcols.map((x) => x.h), { bold: true, fill: LIGHT });
      for (const mv of m.movements) mrow([formatDateBR(mv.date), mv.number, mv.type === 'entrega' ? 'Entrega' : 'Devolução', mv.item, formatNumber(mv.quantity)]);
    }

    // aprovação
    if (doc.y > doc.page.height - 170) doc.addPage();
    section('APROVAÇÃO DA MEDIÇÃO');
    doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text('Declaro que conferi as quantidades e os períodos acima e aprovo esta medição para faturamento.', L, doc.y, { width: W });
    const sy = doc.y + 45;
    const sw = W * 0.45;
    for (const [x, label, sub] of [
      [L, t(company.name), 'Locadora'],
      [L + W - sw, t(cs.name || 'Cliente'), 'Cliente - nome, documento e data'],
    ] as [number, string, string][]) {
      doc.moveTo(x, sy).lineTo(x + sw, sy).lineWidth(0.7).strokeColor('#111827').stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#111827').text(label, x, sy + 4, { width: sw, align: 'center' });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(sub, x, doc.y, { width: sw, align: 'center' });
    }

    doc.page.margins.bottom = 0; // rodapé abaixo da margem sem abrir página nova
    doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(
      t(`Documento sem valor fiscal. ${company.name} • Medição ${m.number} • gerado em ${formatDateTimeBR(new Date().toISOString())}`),
      L, doc.page.height - 34, { width: W, align: 'center', lineBreak: false }
    );
    doc.end();
  });
  audit(db, 'contract', contractId, 'measurement_pdf', user.id, { charge_id: chargeId, number: m.number });
  return { buffer, name: `Medição ${m.number}.pdf` };
}
