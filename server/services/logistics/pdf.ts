/**
 * PDF da operação logística (pdfkit): comprovante de entrega / retirada, termo de devolução,
 * checklist de saída e de retorno e relatório de avarias. Assinatura apenas em campo para preenchimento.
 */

import PDFDocument from 'pdfkit';
import { drawLogo } from '../../pdfLogo';
import { formatBRL, formatNumber } from '../../../shared/orcamentos/money';
import { formatDateTimeBR } from '../../../shared/orcamentos/dates';
import { formatDocument } from '../../../shared/orcamentos/validators';
import { INSPECTION_CHECKLIST } from '../../../shared/estoque/types';
import { EXIT_CHECKLIST, INSPECTION_RESULT_LABELS, OCCURRENCE_STATUS_LABELS, OCCURRENCE_TYPE_LABELS, OP_STATUS_LABELS, OpDetail, PICKUP_REASON_LABELS, RESPONSIBILITY_LABELS, TRANSPORT_LABELS } from '../../../shared/logistica/types';

const BLUE = '#1e3a5f';
const GRAY = '#4b5563';
const LIGHT = '#eef2f7';
const t = (v: unknown) => String(v ?? '').replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[^\S\n]+/g, ' ');

export function renderOperationPdf(o: OpDetail, company: any, showCosts: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const title = o.op_type === 'entrega' ? (['entregue', 'entregue_parcialmente'].includes(o.status) ? 'COMPROVANTE DE ENTREGA' : 'ORDEM DE SEPARAÇÃO E ENTREGA') : o.op_type === 'retirada' ? 'COMPROVANTE DE RETIRADA' : 'TERMO DE DEVOLUÇÃO';
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: `${title} ${o.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = 40;
    const W = doc.page.width - 80;
    const ensure = (h: number) => doc.y + h > doc.page.height - 60 && doc.addPage();
    const section = (s: string) => {
      ensure(40);
      doc.moveDown(0.6);
      doc.rect(L, doc.y, W, 16).fill(LIGHT);
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9).text(t(s.toUpperCase()), L + 6, doc.y + 4, { width: W - 12 });
      doc.moveDown(0.6).fillColor('#111827').font('Helvetica').fontSize(8.5);
    };
    const kv = (pairs: [string, unknown][]) => {
      for (const [k, v] of pairs) {
        if (v === null || v === undefined || v === '') continue;
        ensure(14);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text(t(k), L, y, { width: 140 });
        doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(t(v), L + 145, y, { width: W - 145 });
        doc.moveDown(0.15);
      }
    };
    const table = (cols: [string, number, ('left' | 'right')?][], rows: string[][]) => {
      ensure(30);
      let y = doc.y;
      doc.rect(L, y, W, 15).fill(BLUE);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff');
      for (const [h, w, al] of cols) (doc.text(t(h), x + 3, y + 4, { width: w * W - 6, align: al || 'left' }), (x += w * W));
      doc.y = y + 17;
      doc.font('Helvetica').fontSize(8).fillColor('#111827');
      for (const r of rows) {
        const h = Math.max(...r.map((v, i) => doc.heightOfString(t(v), { width: cols[i][1] * W - 6 }))) + 6;
        ensure(h);
        y = doc.y;
        x = L;
        r.forEach((v, i) => (doc.text(t(v), x + 3, y + 3, { width: cols[i][1] * W - 6, align: cols[i][2] || 'left' }), (x += cols[i][1] * W)));
        doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor('#cbd5e1').stroke();
        doc.y = y + h;
      }
    };

    const logoW = drawLogo(doc, company, L, 40, [80, 49]);
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13).text(t(company?.name), L + logoW, 40, { width: W * 0.5 - logoW });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY);
    for (const line of [company?.document && `CNPJ ${company.document}`, company?.address, [company?.phone, company?.email].filter(Boolean).join(' • ')]) if (line) doc.text(t(line), { width: W * 0.5 - logoW });
    const hb = Math.max(doc.y, logoW ? 89 : 0);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(BLUE).text(t(title), L + W * 0.5, 40, { width: W * 0.5, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#111827').text(t(`Nº ${o.number}`), { width: W * 0.5, align: 'right' });
    doc.fontSize(7.5).fillColor(GRAY).text(t(`Situação: ${OP_STATUS_LABELS[o.status]} • emitido em ${formatDateTimeBR(new Date().toISOString())}`), { width: W * 0.5, align: 'right' });
    doc.y = Math.max(hb, doc.y) + 8;
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1).strokeColor(BLUE).stroke();

    section('Identificação');
    kv([
      ['Cliente', `${o.customer.name}${o.customer.document ? ` — ${formatDocument(o.customer.document)}` : ''}`],
      ['Contrato', o.contract.contract_number],
      ['Motivo', o.reason ? PICKUP_REASON_LABELS[o.reason] : null],
      ['Endereço', o.address],
      ['Contato no local', [o.contact_name, o.contact_phone].filter(Boolean).join(' • ')],
      ['Programada para', formatDateTimeBR(o.scheduled_at)],
      ['Transporte', `${TRANSPORT_LABELS[o.transport_type]}${o.driver_name ? ` • motorista ${o.driver_name}` : ''}${o.vehicle_label ? ` • ${o.vehicle_label}` : ''}${o.carrier_name ? ` • ${o.carrier_name}` : ''}`],
      ['Responsável', o.responsible_name],
      ['Saída / chegada', [o.departed_at && `saída ${formatDateTimeBR(o.departed_at)}`, o.arrived_at && `chegada ${formatDateTimeBR(o.arrived_at)}`].filter(Boolean).join(' • ')],
      [o.op_type === 'entrega' ? 'Entregue em' : 'Recebido em', o.completed_at ? formatDateTimeBR(o.completed_at) : null],
      [o.op_type === 'entrega' ? 'Recebido por' : 'Conferido por', [o.receiver_name, o.receiver_document].filter(Boolean).join(' — ')],
      ['Custo de transporte', showCosts && (o.transport_cost_estimated !== null || o.transport_cost_actual !== null) ? `estimado ${o.transport_cost_estimated !== null ? formatBRL(o.transport_cost_estimated) : '—'} • realizado ${o.transport_cost_actual !== null ? formatBRL(o.transport_cost_actual) : '—'}` : null],
      ['Observações', o.notes],
    ]);

    section('Equipamentos');
    table(
      o.op_type === 'entrega'
        ? [['Código', 0.12], ['Descrição', 0.34], ['Patrimônio/série', 0.16], ['Programado', 0.1, 'right'], ['Separado', 0.1, 'right'], ['Entregue', 0.1, 'right'], ['Estado', 0.08]]
        : [['Código', 0.12], ['Descrição', 0.32], ['Patrimônio/série', 0.16], ['Previsto', 0.1, 'right'], ['Recebido', 0.1, 'right'], ['Faltante', 0.1, 'right'], ['Estado', 0.1]],
      o.items.map((i) => [
        i.item_code,
        i.description + (i.adjust_reason ? `\nAjuste: ${i.adjust_reason}` : ''),
        [i.asset_tag, i.serial_number].filter(Boolean).join(' / ') || '-',
        formatNumber(i.quantity_original),
        formatNumber(o.op_type === 'entrega' ? i.quantity_separated : i.quantity_processed),
        formatNumber(o.op_type === 'entrega' ? i.quantity_processed : i.quantity_missing),
        (o.op_type === 'entrega' ? i.condition_before : i.condition_after) || '-',
      ])
    );
    if (o.accessories) kv([['Acessórios', o.accessories]]);

    if (o.op_type === 'entrega') {
      section('Checklist de saída');
      for (const k of EXIT_CHECKLIST) doc.text(t(`[${o.separation_checklist[k.key] ? 'X' : ' '}] ${k.label}`), L + 4);
      if (o.separated_by_name) doc.fillColor(GRAY).text(t(`Separado por ${o.separated_by_name} em ${formatDateTimeBR(o.separated_at)}`), L + 4).fillColor('#111827');
    }
    if (o.inspections.length) {
      section('Checklist de retorno (inspeção)');
      table(
        [['Equipamento', 0.2], ['Qtd.', 0.07, 'right'], ['Resultado', 0.23], ['Checklist', 0.25], ['Observações', 0.25]],
        o.inspections.map((i) => [i.asset_tag || i.item_code, formatNumber(i.quantity), INSPECTION_RESULT_LABELS[i.result] + (i.work_order_number ? ` (${i.work_order_number})` : ''), INSPECTION_CHECKLIST.filter((c) => i.checklist[c.key]).map((c) => c.label).join('; ') || '-', `${i.notes || '-'}\n${i.inspected_by_name} • ${formatDateTimeBR(i.inspected_at)}`])
      );
    }
    if (o.occurrences.length) {
      section('Relatório de avarias e ocorrências');
      table(
        [['Ocorrência', 0.14], ['Tipo', 0.16], ['Descrição', 0.38], ['Responsabilidade', 0.16], ['Situação', 0.16]],
        o.occurrences.map((x) => [x.number, OCCURRENCE_TYPE_LABELS[x.occurrence_type], x.description + (showCosts && x.estimated_cost ? `\nEstimativa: ${formatBRL(x.estimated_cost)}` : ''), RESPONSIBILITY_LABELS[x.responsibility], OCCURRENCE_STATUS_LABELS[x.status]])
      );
      doc.fontSize(7.5).fillColor(GRAY).text('Ocorrências registradas para análise. A responsabilidade e eventual cobrança dependem de apuração e aprovação.', L, doc.y + 4, { width: W });
    }

    ensure(90);
    doc.moveDown(3);
    const sy = doc.y + 20;
    const sw = W * 0.42;
    doc.moveTo(L, sy).lineTo(L + sw, sy).lineWidth(0.7).strokeColor(GRAY).stroke();
    doc.moveTo(L + W - sw, sy).lineTo(L + W, sy).stroke();
    doc.fontSize(8).fillColor('#111827').text(t(o.op_type === 'entrega' ? 'Recebedor (cliente)' : 'Responsável pela devolução'), L, sy + 4, { width: sw, align: 'center' });
    doc.fillColor(GRAY).fontSize(7.5).text('Nome, documento, data e assinatura', L, doc.y, { width: sw, align: 'center' });
    doc.fillColor('#111827').fontSize(8).text(t(company?.name), L + W - sw, sy + 4, { width: sw, align: 'center' });
    doc.fillColor(GRAY).fontSize(7.5).text('Conferente da locadora', L + W - sw, doc.y, { width: sw, align: 'center' });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(t(`${company?.name} • ${o.number} • contrato ${o.contract.contract_number}`), L, doc.page.height - 32, { width: W * 0.7, lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, L + W * 0.7, doc.page.height - 32, { width: W * 0.3, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
