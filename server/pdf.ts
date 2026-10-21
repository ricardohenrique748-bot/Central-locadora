/**
 * PDF da proposta comercial (pdfkit). Gerado a partir dos dados gravados ou da fotografia da versão.
 * Nunca inclui observações internas, margens ou o histórico de negociação.
 */

import PDFDocument from 'pdfkit';
import { drawLogo } from './pdfLogo';
import { ModuleSettings, Quotation, QuotationItem } from '../shared/orcamentos/types';
import { STATUS_LABELS } from '../shared/orcamentos/status';
import { formatBRL } from '../shared/orcamentos/money';
import { formatDateBR } from '../shared/orcamentos/dates';
import { formatDocument, formatPhone } from '../shared/orcamentos/validators';
import { billingPeriodLabel } from '../shared/orcamentos/rental';

const BLUE = '#1e3a5f';
const ACCENT = '#2AA3D8';
const GRAY = '#4b5563';
const LIGHT = '#eef2f7';
const BORDER = '#cbd5e1';

/** Helvetica padrão usa WinAnsi: troca caracteres fora dele. */
const t = (v: string | null | undefined) =>
  (v || '').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[^\S\n]+/g, ' ');

const PRELIMINARY = ['rascunho', 'em_revisao', 'aguardando_aprovacao'];

export function renderQuotationPdf(q: Quotation, settings: ModuleSettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: `Orçamento ${q.quotation_number}`, Author: settings.company.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // proposta inteira em caixa alta: o texto e as medidas usadas no layout passam pela mesma conversão
    for (const m of ['text', 'heightOfString', 'widthOfString'] as const) {
      const orig = (doc as any)[m].bind(doc);
      (doc as any)[m] = (s: unknown, ...rest: unknown[]) => orig(typeof s === 'string' ? s.toLocaleUpperCase('pt-BR') : s, ...rest);
    }

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 10;
    const isRental = q.quotation_type === 'locacao';
    const isMaint = q.category === 'manutencao';
    const company = settings.company;

    const ensureSpace = (h: number) => {
      if (doc.y + h > bottomLimit()) doc.addPage();
    };

    // ------------------------------------------------ cabeçalho
    const logoW = drawLogo(doc, company, L, 40);
    doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(14).text(t(company.name), L + logoW, 40, { width: W * 0.55 - logoW });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY);
    for (const line of [company.legal_name, company.document && `CNPJ ${company.document}`, company.address, [company.phone, company.email].filter(Boolean).join(' • ')]) {
      if (line) doc.text(t(line), { width: W * 0.55 - logoW });
    }
    const headerBottom = doc.y;

    const boxX = L + W * 0.58;
    const boxW = W * 0.42;
    doc.roundedRect(boxX, 40, boxW, 70, 4).fill(BLUE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(isRental ? 'PROPOSTA DE LOCAÇÃO' : isMaint ? 'ORÇAMENTO DE MANUTENÇÃO' : 'PROPOSTA COMERCIAL DE VENDA', boxX + 10, 48, { width: boxW - 20 });
    doc.fontSize(13).text(q.quotation_number, boxX + 10, 62, { width: boxW - 20 });
    doc.font('Helvetica').fontSize(8);
    doc.text(`Versão ${q.version}   •   Emissão ${formatDateBR(q.issue_date)}`, boxX + 10, 80, { width: boxW - 20 });
    doc.font('Helvetica-Bold').text(`Válida até ${formatDateBR(q.expiration_date)}`, boxX + 10, 92, { width: boxW - 20 });

    doc.y = Math.max(headerBottom, 115) + 8;

    if (PRELIMINARY.includes(q.status)) {
      doc.roundedRect(L, doc.y, W, 18, 3).fill('#fef3c7');
      doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(8).text(`PROPOSTA PRELIMINAR (${STATUS_LABELS[q.status].toUpperCase()}) — SUJEITA A REVISÃO E APROVAÇÃO`, L, doc.y + 5, { width: W, align: 'center' });
      doc.y += 10;
    }

    const sectionTitle = (title: string) => {
      ensureSpace(30);
      doc.moveDown(0.6);
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), L, doc.y);
      doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).lineWidth(1).strokeColor(ACCENT).stroke();
      doc.moveDown(0.5);
    };

    // ------------------------------------------------ cliente
    sectionTitle('Cliente');
    const c = q.customer_snapshot;
    // devolve onde o campo terminou: numa linha de campos, a próxima começa abaixo do mais alto
    const field = (label: string, value: string, x: number, y: number, w: number) => {
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(label, x, y, { width: w });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827').text(t(value) || '—', x, y + 9, { width: w });
      return doc.y;
    };
    let y = doc.y;
    let bottom = Math.max(
      field(c.person_type === 'PJ' ? 'Razão social' : 'Nome', c.name + (c.trade_name ? ` (${c.trade_name})` : ''), L, y, W * 0.6),
      field(c.person_type === 'PJ' ? 'CNPJ' : 'CPF', formatDocument(c.document), L + W * 0.62, y, W * 0.2),
      field('Insc. estadual', c.state_registration || '', L + W * 0.83, y, W * 0.17)
    );
    y = bottom + 6;
    bottom = Math.max(
      field('Endereço', c.address, L, y, W * 0.6),
      field('Telefone / WhatsApp', [formatPhone(c.phone), formatPhone(c.whatsapp)].filter(Boolean).join(' / '), L + W * 0.62, y, W * 0.2),
      field('E-mail', c.email || '', L + W * 0.83, y, W * 0.17)
    );
    doc.y = bottom;
    if (q.client_reference) {
      y = doc.y + 6;
      field('Referência do cliente', q.client_reference, L, y, W);
    }
    doc.x = L;

    // ------------------------------------------------ equipamento do cliente (manutenção)
    const eq = isMaint ? q.equipment_info : null;
    if (eq) {
      sectionTitle('Equipamento');
      y = doc.y;
      field('Equipamento', eq.description, L, y, W * 0.4);
      field('Marca', eq.brand || '—', L + W * 0.4, y, W * 0.2);
      field('Modelo', eq.model || '—', L + W * 0.6, y, W * 0.2);
      field('Nº de série', eq.serial_number || '—', L + W * 0.8, y, W * 0.2);
      doc.x = L;
      for (const [label, value] of [['Defeito relatado', eq.reported_defect], ['Diagnóstico / serviço a executar', eq.diagnosis]] as const) {
        if (!value) continue;
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRAY).text(t(label.toUpperCase()), L, doc.y, { width: W });
        doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(t(value), L, doc.y + 1, { width: W });
      }
    }

    // ------------------------------------------------ período de locação
    if (isRental) {
      sectionTitle('Período proposto');
      y = doc.y;
      const base = billingPeriodLabel(q.rental_billing_period, q.custom_period_label);
      field('Início previsto', formatDateBR(q.start_date), L, y, W * 0.2);
      field('Término previsto', formatDateBR(q.end_date), L + W * 0.2, y, W * 0.2);
      field('Duração', q.rental_days !== null ? `${q.rental_days} dia(s)` : '—', L + W * 0.4, y, W * 0.2);
      field('Base de cobrança', base, L + W * 0.6, y, W * 0.4);
      doc.x = L;
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text(
        t(
          `Contagem de dias: ${settings.rental_policy.day_count_mode === 'exclusive' ? 'data de término menos data de início' : 'inclui o dia de início e o de término'}. ` +
            `Os períodos cobrados por item estão na coluna "Períodos". Disponibilidade dos equipamentos sujeita a confirmação no momento da contratação.`
        ),
        L,
        doc.y,
        { width: W }
      );
    }

    // ------------------------------------------------ itens
    sectionTitle(isRental ? 'Equipamentos' : isMaint ? 'Peças e serviços' : 'Itens');
    const cols = isRental
      ? [
          { k: 'pos', h: '#', w: 0.04, a: 'center' },
          { k: 'code', h: 'Código', w: 0.1, a: 'left' },
          { k: 'desc', h: 'Descrição', w: 0.3, a: 'left' },
          { k: 'qty', h: 'Qtd', w: 0.07, a: 'right' },
          { k: 'per', h: 'Períodos', w: 0.13, a: 'right' },
          { k: 'unit', h: 'Vl. período', w: 0.12, a: 'right' },
          { k: 'disc', h: 'Desconto', w: 0.11, a: 'right' },
          { k: 'total', h: 'Total', w: 0.13, a: 'right' },
        ]
      : [
          { k: 'pos', h: '#', w: 0.04, a: 'center' },
          { k: 'code', h: 'Código', w: 0.11, a: 'left' },
          { k: 'desc', h: 'Descrição', w: 0.37, a: 'left' },
          { k: 'qty', h: 'Qtd', w: 0.09, a: 'right' },
          { k: 'unit', h: 'Vl. unitário', w: 0.13, a: 'right' },
          { k: 'disc', h: 'Desconto', w: 0.12, a: 'right' },
          { k: 'total', h: 'Total', w: 0.14, a: 'right' },
        ];
    const drawHeader = () => {
      const hy = doc.y;
      doc.rect(L, hy, W, 16).fill(LIGHT);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLUE);
      for (const col of cols) {
        doc.text(col.h, x + 3, hy + 5, { width: W * col.w - 6, align: col.a as any });
        x += W * col.w;
      }
      doc.y = hy + 18;
    };
    drawHeader();

    const cellValues = (i: QuotationItem): Record<string, string> => ({
      pos: String(i.position),
      code: i.item_code_snapshot,
      desc: i.description_snapshot.toLocaleUpperCase('pt-BR') + (i.notes ? `\n${i.notes}` : ''),
      qty: `${i.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.unit}`,
      per: `${i.periods.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} × ${billingPeriodLabel(i.billing_period, q.custom_period_label).toLowerCase()}`,
      unit: formatBRL(i.unit_price),
      disc: i.discount_amount > 0 ? `${i.discount_type === 'percent' ? `${i.discount_value.toLocaleString('pt-BR')}% ` : ''}-${formatBRL(i.discount_amount)}` : '—',
      total: formatBRL(i.line_total),
    });

    q.items.forEach((item, idx) => {
      const vals = cellValues(item);
      doc.font('Helvetica').fontSize(7.5);
      const heights = cols.map((col) => doc.heightOfString(t(vals[col.k]), { width: W * col.w - 6 }));
      const rowH = Math.max(...heights) + 8;
      if (doc.y + rowH > bottomLimit()) {
        doc.addPage();
        drawHeader();
      }
      const ry = doc.y;
      if (idx % 2 === 1) doc.rect(L, ry, W, rowH).fill('#f8fafc');
      let x = L;
      for (const col of cols) {
        doc.font(col.k === 'total' ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#111827');
        doc.text(t(vals[col.k]), x + 3, ry + 4, { width: W * col.w - 6, align: col.a as any });
        x += W * col.w;
      }
      doc.moveTo(L, ry + rowH).lineTo(L + W, ry + rowH).lineWidth(0.5).strokeColor(BORDER).stroke();
      doc.y = ry + rowH;
    });

    // ------------------------------------------------ totais
    const lines: [string, number, boolean?][] = [];
    lines.push([isRental ? 'Subtotal da locação (bruto)' : 'Subtotal dos itens (bruto)', q.items_gross_total]);
    if (q.item_discount_total > 0) lines.push(['Descontos nos itens', -q.item_discount_total]);
    lines.push(['Subtotal', q.subtotal]);
    if (q.general_discount > 0) lines.push([`Desconto geral${q.general_discount_type === 'percent' ? ` (${q.general_discount_value.toLocaleString('pt-BR')}%)` : ''}`, -q.general_discount]);
    if (q.additional_charges > 0) lines.push(['Acréscimos', q.additional_charges]);
    if (q.freight_amount > 0) lines.push([isRental ? 'Frete de entrega' : 'Frete / entrega', q.freight_amount]);
    if (q.pickup_freight_amount > 0) lines.push(['Frete de retirada', q.pickup_freight_amount]);
    if (q.installation_amount > 0) lines.push(['Montagem / instalação', q.installation_amount]);
    if (q.other_services_amount > 0) lines.push(['Outros serviços', q.other_services_amount]);

    ensureSpace(lines.length * 13 + 60);
    doc.moveDown(0.8);
    const tx = L + W * 0.55;
    const tw = W * 0.45;
    for (const [label, value] of lines) {
      const ly = doc.y;
      doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(label, tx, ly, { width: tw * 0.6 });
      doc.fillColor('#111827').text(value < 0 ? `- ${formatBRL(-value)}` : formatBRL(value), tx + tw * 0.6, ly, { width: tw * 0.4, align: 'right' });
      doc.y = ly + 13;
    }
    const totY = doc.y + 2;
    doc.roundedRect(tx, totY, tw, 24, 3).fill(BLUE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(10).text(isRental ? 'TOTAL PREVISTO' : 'VALOR TOTAL', tx + 8, totY + 7, { width: tw * 0.5 });
    doc.text(formatBRL(q.total_amount), tx + tw * 0.4, totY + 7, { width: tw * 0.6 - 8, align: 'right' });
    doc.y = totY + 30;
    if (isRental && q.deposit_amount > 0) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text(`Caução: ${formatBRL(q.deposit_amount)}`, tx, doc.y, { width: tw, align: 'right' });
      doc.font('Helvetica').fontSize(7).fillColor(GRAY).text('Valor de garantia, não incluído no total e não constitui pagamento da locação. Devolução conforme condições contratuais.', tx, doc.y, { width: tw, align: 'right' });
    }
    doc.x = L;

    // ------------------------------------------------ condições
    const conditions: [string, string | null][] = [
      ['Descrição complementar', q.complementary_description],
      ['Condições de pagamento', q.payment_terms],
      ['Prazo de entrega', q.delivery_terms],
      [isMaint ? 'Garantia do serviço' : 'Garantia', q.warranty_terms],
      ['Retirada / entrega', q.pickup_delivery_terms],
      ['Acessórios incluídos', q.included_accessories],
      ['Responsabilidades do cliente', q.customer_responsibilities],
      ['Condições de devolução', q.return_conditions],
      ['Condições específicas', q.specific_conditions],
      ['Observações', q.commercial_notes],
    ];
    const filled = conditions.filter(([, v]) => v && v.trim());
    if (filled.length) {
      sectionTitle('Condições comerciais');
      for (const [label, value] of filled) {
        ensureSpace(30);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text(label, L, doc.y, { width: W });
        doc.font('Helvetica').fontSize(8).fillColor('#111827').text(t(value), L, doc.y + 1, { width: W });
        doc.moveDown(0.4);
      }
    }

    // ------------------------------------------------ aceite
    ensureSpace(90);
    doc.moveDown(1.5);
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(
      `Declaro estar de acordo com os itens, valores e condições desta proposta (${q.quotation_number}, versão ${q.version}).`,
      L,
      doc.y,
      { width: W }
    );
    const sy = doc.y + 40;
    const sw = W * 0.42;
    doc.moveTo(L, sy).lineTo(L + sw, sy).lineWidth(0.7).strokeColor(GRAY).stroke();
    doc.moveTo(L + W - sw, sy).lineTo(L + W, sy).stroke();
    doc.fontSize(7.5).fillColor('#111827').text(t(c.name), L, sy + 4, { width: sw, align: 'center' });
    doc.fillColor(GRAY).text('Cliente — nome, data e assinatura', L, doc.y, { width: sw, align: 'center' });
    doc.fillColor('#111827').text(t(company.name), L + W - sw, sy + 4, { width: sw, align: 'center' });
    doc.fillColor(GRAY).text(t(`Responsável: ${q.responsible_name}`), L + W - sw, doc.y, { width: sw, align: 'center' });

    // ------------------------------------------------ rodapé com numeração
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 32;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor(GRAY);
      doc.text(t(`${company.name} • ${q.quotation_number} v${q.version}`), L, fy, { width: W / 2, lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, fy, { width: W / 2, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
