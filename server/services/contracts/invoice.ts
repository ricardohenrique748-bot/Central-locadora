/**
 * Fatura de locação de uma cobrança do contrato (PDF gerado na hora, sem valor fiscal).
 * Usa o valor gravado na cobrança e a situação real do título no Financeiro; o número é o do título.
 */

import PDFDocument from 'pdfkit';
import { DB, audit } from '../../db';
import { forbidden, notFound } from '../../http';
import { drawLogo } from '../../pdfLogo';
import { getSettings } from '../../settings';
import { AuthUser } from '../../../shared/orcamentos/types';
import { contractCan } from '../../../shared/contratos/rules';
import { formatBRL, formatNumber } from '../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../shared/orcamentos/dates';
import { formatDocument, formatPhone } from '../../../shared/orcamentos/validators';
import { contractChargeState } from '../finance/integrations';

const BLUE = '#1e3a5f';
const GRAY = '#4b5563';
const LIGHT = '#eef2f7';
const BORDER = '#cbd5e1';
const t = (v: unknown) => String(v ?? '').replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[^\S\n]+/g, ' ');

const SITUATION: Record<string, string> = { aberto: 'EM ABERTO', parcial: 'PAGA PARCIALMENTE', liquidado: 'PAGA', cancelado: 'CANCELADA' };

export async function chargeInvoicePdf(db: DB, user: AuthUser, contractId: number, chargeId: number): Promise<{ buffer: Buffer; name: string }> {
  if (!contractCan.view(user) || !contractCan.viewFinance(user)) throw forbidden('Seu perfil não acessa os valores financeiros do contrato.');
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as any;
  if (!c) throw notFound('Contrato não encontrado.');
  const ch = db.prepare('SELECT * FROM contract_charges WHERE id = ? AND contract_id = ?').get(chargeId, contractId) as any;
  if (!ch) throw notFound('Cobrança não encontrada.');
  if (ch.status === 'cancelado' || !ch.financial_entry_id) throw notFound('Cobrança cancelada ou ainda não lançada no Financeiro: não há fatura.');
  const st = contractChargeState(db, ch.financial_entry_id);
  if (!st) throw notFound('Título da cobrança não encontrado no Financeiro.');
  const items = db.prepare("SELECT * FROM contract_items WHERE contract_id = ? AND modality = 'locacao' ORDER BY position").all(contractId) as any[];
  const company = getSettings(db).company;
  const cs = JSON.parse(c.customer_snapshot || '{}');
  const situation = st.entry_status === 'cancelado' ? 'cancelado' : st.status;
  const balance = Math.max(0, st.updated - st.settled_amount);

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, info: { Title: `Fatura ${st.entry_number}`, Author: company.name } });
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
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('FATURA DE LOCAÇÃO', bx + 10, 48, { width: bw - 20 });
    doc.fontSize(14).text(t(st.entry_number), { width: bw - 20 });
    doc.font('Helvetica').fontSize(8).text(t(`Emissão: ${formatDateBR(new Date().toISOString())}   •   Contrato ${c.contract_number}`), { width: bw - 20 });
    doc.font('Helvetica-Bold').text(t(`Vencimento: ${formatDateBR(st.due_date)}`), { width: bw - 20 });
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

    section('CLIENTE');
    kv([
      ['Nome / Razão social', cs.name],
      [cs.person_type === 'PF' ? 'CPF' : 'CNPJ', cs.document ? formatDocument(cs.document) : null],
      ['Endereço', [cs.address, cs.city && `${cs.city}${cs.state ? `/${cs.state}` : ''}`].filter(Boolean).join(' - ')],
      ['Contato', [cs.contact_name, cs.phone && formatPhone(cs.phone), cs.email].filter(Boolean).join(' • ')],
    ]);
    section('REFERÊNCIA');
    kv([
      ['Contrato', c.contract_number],
      ['Período cobrado', ch.period_start ? `${formatDateBR(ch.period_start)} a ${formatDateBR(ch.period_end)}` : null],
      ['Local da obra / entrega', c.delivery_address],
      ['Descrição', ch.description],
    ]);

    // itens
    section('DISCRIMINAÇÃO');
    const cols = [
      { h: 'Código', w: 0.13, a: 'left' as const },
      { h: 'Descrição', w: 0.45, a: 'left' as const },
      { h: 'Qtd.', w: 0.1, a: 'right' as const },
      { h: 'Valor unit.', w: 0.15, a: 'right' as const },
      { h: 'Total', w: 0.17, a: 'right' as const },
    ];
    const row = (vals: string[], opts: { bold?: boolean; fill?: string } = {}) => {
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      const h = Math.max(...vals.map((v, i) => doc.heightOfString(t(v), { width: cols[i].w * W - 8 }))) + 8;
      if (opts.fill) doc.rect(L, y, W, h).fill(opts.fill);
      let x = L;
      vals.forEach((v, i) => {
        doc.fillColor('#111827').text(t(v), x + 4, y + 4, { width: cols[i].w * W - 8, align: cols[i].a });
        x += cols[i].w * W;
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(BORDER).stroke();
      doc.y = y + h;
    };
    row(cols.map((c2) => c2.h), { bold: true, fill: LIGHT });
    let listed = 0;
    if (ch.kind === 'periodo') {
      for (const it of items) {
        row([it.item_code_snapshot, it.description_snapshot, `${formatNumber(it.quantity)} ${it.unit}`, formatBRL(it.unit_price), formatBRL(it.line_total - (it.discount_amount || 0))]);
        listed += it.line_total - (it.discount_amount || 0);
      }
      if (listed !== ch.amount) row(['', ch.amount < listed ? 'Ajuste do período (proporcional/desconto)' : 'Acréscimos do período', '', '', formatBRL(ch.amount - listed)]);
    } else row(['', ch.description, '1', formatBRL(ch.amount), formatBRL(ch.amount)]);

    // totais
    doc.moveDown(0.6);
    const tot = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? BLUE : '#111827');
      const y = doc.y;
      doc.text(t(label), L + W * 0.5, y, { width: W * 0.3, align: 'right' });
      doc.text(t(value), L + W * 0.8, y, { width: W * 0.2, align: 'right' });
      doc.moveDown(0.25);
    };
    tot('Valor da fatura', formatBRL(st.updated), true);
    if (st.settled_amount > 0) {
      tot('Valor recebido', formatBRL(st.settled_amount));
      tot('Saldo a pagar', formatBRL(balance), true);
    }
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(situation === 'liquidado' ? '#047857' : situation === 'cancelado' ? '#b91c1c' : BLUE).text(t(`Situação: ${SITUATION[situation] || situation}`), L, doc.y, { width: W, align: 'right' });

    section('PAGAMENTO');
    kv([
      ['Vencimento', formatDateBR(st.due_date)],
      ['Condição de pagamento', c.payment_terms],
      ['Após o vencimento', `multa de ${formatNumber(c.late_fee_percent)}% e juros de ${formatNumber(c.interest_month_percent)}% ao mês`],
    ]);
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text('Boleto e PIX serão anexados quando a cobrança bancária estiver configurada no sistema.', L, doc.y + 2, { width: W });

    doc.page.margins.bottom = 0; // rodapé abaixo da margem sem abrir página nova
    doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(
      t(`Documento sem valor fiscal. Locação de bens móveis. ${company.name} • ${st.entry_number} • gerado em ${formatDateTimeBR(new Date().toISOString())}`),
      L, doc.page.height - 34, { width: W, align: 'center', lineBreak: false }
    );
    doc.end();
  });
  audit(db, 'contract', contractId, 'invoice_pdf', user.id, { charge_id: chargeId, entry_number: st.entry_number });
  return { buffer, name: `Fatura ${st.entry_number}.pdf` };
}
