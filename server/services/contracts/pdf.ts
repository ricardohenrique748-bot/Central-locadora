/**
 * PDFs do contrato (pdfkit), sempre a partir da fotografia gravada no documento:
 * contrato, aditivo e comprovantes de entrega/devolução.
 */

import PDFDocument from 'pdfkit';
import { drawLogo } from '../../pdfLogo';
import { formatBRL, formatNumber } from '../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../shared/orcamentos/dates';
import { formatDocument, formatPhone } from '../../../shared/orcamentos/validators';
import {
  AMENDMENT_LABELS,
  BILLING_FREQUENCY_LABELS,
  BILLING_TIMING_LABELS,
  CONTRACT_TYPE_LABELS,
  DELIVERY_CHECKLIST,
  DOCUMENT_STATUS_LABELS,
  PERIOD_NOUN,
  RESPONSIBILITY_LABELS,
  RESPONSIBILITY_TOPICS,
  RETURN_CLASS_LABELS,
} from '../../../shared/contratos/types';

const BLUE = '#1e3a5f';
const GRAY = '#4b5563';
const LIGHT = '#eef2f7';
const BORDER = '#cbd5e1';
const t = (v: unknown) => String(v ?? '').replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[^\S\n]+/g, ' ');

const TITLES: Record<string, string> = {
  contrato: 'CONTRATO',
  aditivo: 'TERMO ADITIVO',
  comprovante_entrega: 'COMPROVANTE DE ENTREGA',
  comprovante_devolucao: 'COMPROVANTE DE DEVOLUÇÃO',
};

export function renderContractDocumentPdf(snap: any, meta: { version: number; status: string; showValues: boolean }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const c = snap.contract;
    const company = snap.company || {};
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: `${TITLES[snap.type]} ${c.contract_number}`, Author: company.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (b) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const ensure = (h: number) => {
      if (doc.y + h > doc.page.height - doc.page.margins.bottom - 10) doc.addPage();
    };
    const money = (v: number) => (meta.showValues ? formatBRL(v) : '***');
    const section = (title: string) => {
      ensure(40);
      doc.moveDown(0.7);
      doc.rect(L, doc.y, W, 16).fill(LIGHT);
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(9).text(t(title.toUpperCase()), L + 6, doc.y + 4, { width: W - 12 });
      doc.moveDown(0.6);
      doc.fillColor('#111827').font('Helvetica').fontSize(8.5);
    };
    const kv = (pairs: [string, string | null | undefined][]) => {
      for (const [k, v] of pairs) {
        if (!v) continue;
        ensure(14);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text(t(k), L, y, { width: 130 });
        doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(t(v), L + 135, y, { width: W - 135 });
        doc.moveDown(0.2);
      }
    };
    const table = (cols: { label: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: string[][]) => {
      const head = () => {
        ensure(30);
        const y = doc.y;
        doc.rect(L, y, W, 16).fill(BLUE);
        let x = L;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff');
        for (const col of cols) {
          doc.text(t(col.label), x + 3, y + 4, { width: col.w * W - 6, align: col.align || 'left' });
          x += col.w * W;
        }
        doc.y = y + 18;
      };
      head();
      doc.font('Helvetica').fontSize(8).fillColor('#111827');
      rows.forEach((r, ri) => {
        const hs = r.map((v, i) => doc.heightOfString(t(v), { width: cols[i].w * W - 6 }));
        const h = Math.max(...hs) + 6;
        if (doc.y + h > doc.page.height - doc.page.margins.bottom - 10) {
          doc.addPage();
          head();
          doc.font('Helvetica').fontSize(8).fillColor('#111827');
        }
        const y = doc.y;
        if (ri % 2) doc.rect(L, y, W, h).fill('#f8fafc').fillColor('#111827');
        let x = L;
        r.forEach((v, i) => {
          doc.text(t(v), x + 3, y + 3, { width: cols[i].w * W - 6, align: cols[i].align || 'left' });
          x += cols[i].w * W;
        });
        doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(BORDER).stroke();
        doc.y = y + h;
      });
      doc.moveDown(0.3);
    };
    // assinatura da locadora (gravada no documento na emissão) desenhada sobre a linha; o cliente assina a dele
    const lessorSig = snap.lessor_signature as { image: string; name: string | null } | undefined;
    const isLessor = (title: string) => /^(locadora|contratada)/i.test(title.trim()) || title.trim() === company.name;
    const drawLessorSig = (x: number, lineY: number, w: number) => {
      if (!lessorSig?.image) return;
      try {
        const img = Buffer.from(lessorSig.image.split(',')[1], 'base64');
        const boxW = Math.min(w, 190);
        doc.image(img, x + (w - boxW) / 2, lineY - 50, { fit: [boxW, 48], align: 'center', valign: 'bottom' });
      } catch {
        /* imagem inválida: fica só a linha */
      }
    };
    const signatures = (left: [string, string], right: [string, string]) => {
      const withSig = !!lessorSig && isLessor(right[1]) && (snap.type === 'contrato' || snap.type === 'aditivo');
      ensure(withSig ? 110 : 80);
      doc.moveDown(withSig ? 4.5 : 2.5);
      const sy = doc.y + 25;
      const sw = W * 0.42;
      doc.moveTo(L, sy).lineTo(L + sw, sy).lineWidth(0.7).strokeColor(GRAY).stroke();
      doc.moveTo(L + W - sw, sy).lineTo(L + W, sy).stroke();
      if (withSig) drawLessorSig(L + W - sw, sy, sw);
      doc.font('Helvetica').fontSize(8).fillColor('#111827').text(t(left[0]), L, sy + 4, { width: sw, align: 'center' });
      doc.fillColor(GRAY).fontSize(7.5).text(t(left[1]), L, doc.y, { width: sw, align: 'center' });
      doc.fillColor('#111827').fontSize(8).text(t(right[0]), L + W - sw, sy + 4, { width: sw, align: 'center' });
      doc.fillColor(GRAY).fontSize(7.5).text(t(right[1]), L + W - sw, doc.y, { width: sw, align: 'center' });
      doc.moveDown(1);
    };

    // ------------------------------------------------ cabeçalho (empresa + tipo/nº do documento)
    const header = () => {
      const logoW = drawLogo(doc, company, L, 40, [80, 49]);
      doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(13).text(t(company.name), L + logoW, 40, { width: W * 0.6 - logoW });
      doc.font('Helvetica').fontSize(7.5).fillColor(GRAY);
      for (const line of [company.legal_name, company.document && `CNPJ ${company.document}`, company.address, [company.phone, company.email].filter(Boolean).join(' • ')]) if (line) doc.text(t(line), { width: W * 0.6 - logoW });
      const hb = Math.max(doc.y, logoW ? 89 : 0);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(BLUE).text(t(TITLES[snap.type]), L + W * 0.6, 40, { width: W * 0.4, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor('#111827').text(t(`Nº ${c.contract_number}`), { width: W * 0.4, align: 'right' });
      doc.fontSize(7.5).fillColor(GRAY).text(t(`${CONTRACT_TYPE_LABELS[c.contract_type as 'locacao']} • versão ${meta.version} • ${DOCUMENT_STATUS_LABELS[meta.status as 'gerado'] || meta.status}`), { width: W * 0.4, align: 'right' });
      doc.text(t(`Emitido em ${formatDateTimeBR(snap.generated_at)}`), { width: W * 0.4, align: 'right' });
      doc.y = Math.max(hb, doc.y) + 8;
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(1).strokeColor(BLUE).stroke();
      doc.moveDown(0.5);
    };

    const parties = () => {
      const cs = c.customer_snapshot;
      section('Partes');
      kv([
        ['Contratada', `${company.name}${company.document ? ` — CNPJ ${company.document}` : ''}`],
        ['Contratante', cs.name + (cs.trade_name ? ` (${cs.trade_name})` : '')],
        [cs.person_type === 'PJ' ? 'CNPJ' : 'CPF', cs.document ? formatDocument(cs.document) : 'não informado'],
        ['Inscrição estadual', cs.state_registration],
        ['Endereço', cs.address],
        ['Contato', [cs.contact_name, cs.phone && formatPhone(cs.phone), cs.email].filter(Boolean).join(' • ')],
      ]);
    };

    // capa do contrato: vigência, local de entrega, itens, valores discriminados e cronograma
    const cover = () => {
      const cs = c.customer_snapshot;
      section('Objeto e vigência');
      kv([
        ['Vigência', `${formatDateBR(c.start_date)} a ${c.end_date ? formatDateBR(c.end_date) : 'prazo indeterminado'}`],
        ['Local de entrega', c.delivery_address || (cs.address ? `${cs.address} (endereço do cliente)` : 'não informado')],
        ['Cobrança', c.contract_type === 'venda' ? `${c.installments_count}x` : `${BILLING_FREQUENCY_LABELS[c.billing_frequency as 'mensal']}${c.billing_frequency === 'personalizado' ? ` (${c.custom_period_days} dias)` : ''} — ${BILLING_TIMING_LABELS[c.billing_timing as 'antecipado']}`],
      ]);
      // contrato com término: mostra o valor total de cada item no período todo, não o valor por período
      const rentalTotal = (snap.schedule || []).filter((l: any) => String(l.description).startsWith('Locação')).reduce((a: number, l: any) => a + l.amount, 0);
      const periodFactor = c.contract_type === 'locacao' && c.end_date && c.billing_frequency !== 'unico' && c.period_amount > 0 && rentalTotal > 0 ? rentalTotal / c.period_amount : null;
      const itemValue = (i: any) =>
        i.modality === 'venda' || c.billing_frequency === 'unico' ? money(i.line_total) : periodFactor !== null ? money(Math.round(i.line_total * periodFactor)) : `${money(i.line_total)}/${PERIOD_NOUN[c.billing_frequency as 'mensal']}`;
      section('Equipamentos e produtos');
      table(
        [
          { label: 'Código', w: 0.12 },
          { label: 'Descrição', w: 0.36 },
          { label: 'Patrimônio/série', w: 0.14 },
          { label: 'Qtd.', w: 0.08, align: 'right' },
          { label: 'Modalidade', w: 0.1 },
          { label: 'Valor', w: 0.2, align: 'right' },
        ],
        c.items.map((i: any) => [
          i.item_code,
          i.description + (i.conditions ? `\n${i.conditions}` : ''),
          [i.asset_tag, i.serial_number].filter(Boolean).join(' / ') || '—',
          `${formatNumber(i.quantity)} ${i.unit}`,
          i.modality === 'venda' ? 'Venda' : 'Locação',
          itemValue(i),
        ])
      );
      section('Valores');
      kv([
        ['Valor por período', c.contract_type === 'locacao' && c.billing_frequency !== 'unico' && periodFactor === null ? `${money(c.period_amount)} por ${PERIOD_NOUN[c.billing_frequency as 'mensal']}` : null],
        ['Desconto geral', c.general_discount ? money(c.general_discount) : null],
        ['Frete de entrega / retirada', c.freight_delivery || c.freight_pickup ? `${money(c.freight_delivery)} / ${money(c.freight_pickup)}` : null],
        [c.other_fees_description || 'Taxas adicionais', c.other_fees ? money(c.other_fees) : null],
        ['Caução', c.deposit_amount ? money(c.deposit_amount) : null],
        [c.end_date || c.contract_type === 'venda' ? 'Valor total do contrato' : 'Valor total', c.estimated_total !== null ? money(c.estimated_total) : 'prazo indeterminado — cobrança por período'],
        ['Multa / juros por atraso', `${c.late_fee_percent}% / ${c.interest_month_percent}% ao mês`],
        ['Responsabilidades', RESPONSIBILITY_TOPICS.map((r) => `${r.label}: ${RESPONSIBILITY_LABELS[(c.responsibilities?.[r.key] || 'a_combinar') as 'cliente']}`).join(' • ')],
      ]);
      // cobrança diária com término definido: o total já basta, sem uma linha por dia
      if (snap.schedule?.length && meta.showValues && !(c.billing_frequency === 'diaria' && periodFactor !== null)) {
        section('Cronograma previsto de cobranças');
        table(
          [
            { label: 'Descrição', w: 0.55 },
            { label: 'Vencimento', w: 0.2 },
            { label: 'Valor', w: 0.25, align: 'right' },
          ],
          snap.schedule.slice(0, 60).map((l: any) => [l.description, formatDateBR(l.due_date), formatBRL(l.amount)])
        );
      }
    };

    // ------------------------------------------------ contrato de locação (modelo da empresa)
    const rentalContract = () => {
      const cs = c.customer_snapshot;
      // capa no mesmo padrão dos demais documentos; as cláusulas do modelo começam na página seguinte
      header();
      parties();
      cover();
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827').text(t('CONTRATO DE LOCAÇÃO DE BENS MÓVEIS'), L, doc.page.margins.top, { width: W, align: 'center' });
      doc.moveDown(0.6);
      doc.fontSize(10).text(t(`CONTRATO Nº: ${c.contract_number}`), L, doc.y, { width: W });
      doc.font('Helvetica-Bold').text('Local: ', L, doc.y, { width: W, continued: true }).font('Helvetica').text(t(c.delivery_address || cs.address || ''));
      doc.moveDown(0.6);

      const rentalItems = c.items.filter((i: any) => i.modality !== 'venda');
      const desc = (i: any) => i.description + (i.asset_tag ? ` (patrimônio ${i.asset_tag})` : '');
      const periodLabel = BILLING_FREQUENCY_LABELS[c.billing_frequency as 'mensal'] + (c.billing_frequency === 'personalizado' ? ` (${c.custom_period_days} dias)` : '');
      const tables: Record<string, () => void> = {
        tabela_itens: () =>
          table(
            [
              { label: 'Item', w: 0.5 },
              { label: 'Qtd', w: 0.08, align: 'right' },
              { label: 'Período', w: 0.14 },
              { label: 'Valor', w: 0.14, align: 'right' },
              { label: 'Total', w: 0.14, align: 'right' },
            ],
            c.items.map((i: any) => [desc(i), formatNumber(i.quantity), i.modality === 'venda' ? 'Venda' : periodLabel, money(i.unit_price), money(i.line_total)])
          ),
        tabela_prazo: () =>
          table(
            [
              { label: 'Item', w: 0.7 },
              { label: 'Qtd', w: 0.1, align: 'right' },
              { label: 'Período', w: 0.2 },
            ],
            rentalItems.map((i: any) => [desc(i), formatNumber(i.quantity), periodLabel])
          ),
        tabela_reposicao: () =>
          table(
            [
              { label: 'Item', w: 0.66 },
              { label: 'Qtd', w: 0.1, align: 'right' },
              { label: 'Valor Reposição (unit.)', w: 0.24, align: 'right' },
            ],
            rentalItems.map((i: any) => [desc(i), formatNumber(i.quantity), i.replacement_value ? money(i.replacement_value) : 'a definir'])
          ),
      };

      const sign = (title: string, sub: string) => {
        const withSig = !!lessorSig && isLessor(title);
        ensure(withSig ? 100 : 70);
        doc.moveDown(withSig ? 4.6 : 2.2);
        const y = doc.y;
        doc.moveTo(L, y).lineTo(L + W * 0.75, y).lineWidth(0.7).strokeColor(GRAY).stroke();
        if (withSig) drawLessorSig(L, y, W * 0.4);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(t(title), L, y + 4, { width: W });
        doc.font('Helvetica').text(t(sub), L, doc.y, { width: W });
        if (withSig && lessorSig?.name) doc.fontSize(8).fillColor(GRAY).text(t(`Representante: ${lessorSig.name}`), L, doc.y, { width: W });
        doc.moveDown(0.6);
      };

      for (const para of String(snap.clauses || '').split(/\n[^\S\n]*\n/)) {
        const p = para.trim();
        if (!p) continue;
        const tb = /^\{\{(tabela_\w+)\}\}$/.exec(p);
        if (tb && tables[tb[1]]) {
          tables[tb[1]]();
          doc.moveDown(0.4);
          continue;
        }
        const sg = /^\{\{assinatura\|([^|]*)\|([^|]*)\}\}$/.exec(p);
        if (sg) {
          sign(sg[1], sg[2]);
          continue;
        }
        if (p === '{{testemunhas}}') {
          signatures(['Testemunha 1', 'Nome / CPF'], ['Testemunha 2', 'Nome / CPF']);
          continue;
        }
        ensure(30);
        // **texto** = negrito; o restante em fonte normal, justificado. O espaço entre trechos fica no fim do anterior
        // (o pdfkit descarta espaço no início de um trecho "continued").
        const parts = p.split(/\*\*([\s\S]+?)\*\*/).map((x, i) => ({ x: t(x), bold: i % 2 === 1 }));
        parts.forEach((s, i) => {
          const lead = /^\s+/.exec(s.x);
          if (lead && i > 0) {
            parts[i - 1].x += lead[0];
            s.x = s.x.slice(lead[0].length);
          }
        });
        const segs = parts.filter((s) => s.x.trim());
        doc.fillColor('#111827').fontSize(9);
        doc.x = L;
        segs.forEach((s, i) => {
          const o = { width: W, align: 'justify' as const, continued: i < segs.length - 1 };
          doc.font(s.bold ? 'Helvetica-Bold' : 'Helvetica');
          if (i === 0) doc.text(s.x, L, doc.y, o);
          else doc.text(s.x, o);
        });
        doc.moveDown(0.6);
      }
    };

    if (snap.type === 'contrato' && snap.layout === 'locacao_bens_moveis') rentalContract();
    else {
      header();

      const cs = c.customer_snapshot;
      parties();

      if (snap.type === 'contrato') {
        cover();
        section('Cláusulas e condições');
        for (const block of String(snap.clauses || '').split(/\n(?=## )/)) {
          const [first, ...rest] = block.split('\n');
          ensure(30);
          if (first.startsWith('## ')) doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLUE).text(t(first.slice(3)), L, doc.y, { width: W });
          else doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRAY).text(t(first), L, doc.y, { width: W });
          if (rest.join('\n').trim()) doc.font('Helvetica').fontSize(8.5).fillColor('#111827').text(t(rest.join('\n').trim()), L, doc.y + 1, { width: W, align: 'justify' });
          doc.moveDown(0.5);
        }
        signatures([cs.name, 'Contratante — nome, documento, data e assinatura'], [company.name, 'Contratada — representante e data']);
      } else if (snap.type === 'aditivo') {
        const a = snap.amendment || {};
        section(`Aditivo nº ${a.number} — ${AMENDMENT_LABELS[a.amendment_type as 'prorrogacao'] || ''}`);
        kv([
          ['Descrição', a.description],
          ['Justificativa', a.reason],
          ['Término anterior', a.previous_end ? formatDateBR(a.previous_end) : a.amendment_type === 'prorrogacao' || a.amendment_type === 'renovacao' ? 'indeterminado' : null],
          ['Novo término', a.new_end ? formatDateBR(a.new_end) : null],
          ['Valor anterior por período', a.previous_amount !== null && a.previous_amount !== undefined ? money(a.previous_amount) : null],
          ['Novo valor por período', a.new_amount !== null && a.new_amount !== undefined ? money(a.new_amount) : null],
          ['Vigência da alteração', a.effective_date ? formatDateBR(a.effective_date) : null],
          ['Registrado por', `${a.created_by_name || ''} em ${formatDateTimeBR(a.created_at)}`],
        ]);
        if (snap.added_items?.length) {
          section('Itens incluídos');
          table(
            [
              { label: 'Código', w: 0.12 },
              { label: 'Descrição', w: 0.36 },
              { label: 'Patrimônio/série', w: 0.14 },
              { label: 'Qtd.', w: 0.08, align: 'right' },
              { label: 'Modalidade', w: 0.1 },
              { label: 'Valor', w: 0.2, align: 'right' },
            ],
            snap.added_items.map((i: any) => [
              i.item_code,
              i.description + (i.conditions ? `\n${i.conditions}` : ''),
              [i.asset_tag, i.serial_number].filter(Boolean).join(' / ') || '—',
              `${formatNumber(i.quantity)} ${i.unit}`,
              i.modality === 'venda' ? 'Venda' : 'Locação',
              i.modality === 'venda' ? money(i.line_total) : `${money(i.line_total)}/${PERIOD_NOUN[c.billing_frequency as 'mensal']}`,
            ])
          );
        }
        doc.moveDown(0.5).font('Helvetica').fontSize(8.5).fillColor('#111827').text('As demais cláusulas e condições do contrato permanecem inalteradas.', L, doc.y, { width: W });
        signatures([cs.name, 'Contratante'], [company.name, 'Contratada']);
      } else {
        const o = snap.operation || { items: [] };
        const isDelivery = snap.type === 'comprovante_entrega';
        section(`${isDelivery ? 'Entrega' : 'Devolução'} ${o.number}`);
        kv([
          ['Data e hora', formatDateTimeBR(o.performed_at)],
          ['Responsável (locadora)', o.responsible_name],
          [isDelivery ? 'Recebido por' : 'Devolvido por', [o.counterpart_name, o.counterpart_document].filter(Boolean).join(' — ')],
          ['Acessórios', o.accessories],
          ['Observações', o.notes],
        ]);
        table(
          [
            { label: 'Código', w: 0.14 },
            { label: 'Descrição', w: 0.36 },
            { label: 'Patrimônio', w: 0.14 },
            { label: 'Qtd.', w: 0.1, align: 'right' },
            { label: isDelivery ? 'Estado' : 'Situação', w: 0.26 },
          ],
          o.items.map((i: any) => [
            i.item_code,
            i.description + (i.notes ? `\n${i.notes}` : ''),
            i.asset_tag || '—',
            formatNumber(i.quantity),
            isDelivery
              ? i.condition || '—'
              : [i.classification ? RETURN_CLASS_LABELS[i.classification as 'avaria'] : null, i.damaged_qty ? `${i.damaged_qty} avariada(s)` : null, i.maintenance_qty ? `${i.maintenance_qty} p/ manutenção` : null, i.missing_qty ? `${i.missing_qty} não devolvida(s)` : null]
                  .filter(Boolean)
                  .join('; '),
          ])
        );
        if (isDelivery) {
          ensure(60);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(BLUE).text('Checklist de conferência', L, doc.y + 4);
          doc.font('Helvetica').fontSize(8).fillColor('#111827');
          for (const k of DELIVERY_CHECKLIST) doc.text(t(`[${o.checklist?.[k.key] ? 'X' : ' '}] ${k.label}`), L + 6, doc.y + 1);
        }
        signatures([o.counterpart_name || cs.name, isDelivery ? 'Recebedor — assinatura' : 'Cliente — assinatura'], [o.responsible_name || company.name, 'Conferente da locadora']);
      }

    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 32;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor(GRAY);
      doc.text(t(`${company.name} • ${c.contract_number} • ${TITLES[snap.type]} v${meta.version}`), L, fy, { width: W * 0.7, lineBreak: false });
      doc.text(`Página ${i + 1} de ${range.count}`, L + W * 0.7, fy, { width: W * 0.3, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
