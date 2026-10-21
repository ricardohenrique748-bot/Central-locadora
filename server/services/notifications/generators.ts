/**
 * Geradores de eventos: leem os dados reais de cada módulo e devolvem candidatos a notificação.
 * Cada candidato tem uma chave lógica (event_key) que identifica o evento — tipo + registro + janela/regra —
 * para que o processamento recorrente nunca duplique a mesma notificação.
 */

import { DB } from '../../db';
import { addDaysISO, daysBetween, formatDateBR, todayISO } from '../../../shared/orcamentos/dates';
import { formatBRL } from '../../../shared/orcamentos/money';
import { EventSetting, NotificationLink } from '../../../shared/notificacoes/types';

export interface Candidate {
  event_type: string;
  key: string;
  title: string;
  message: string;
  source_module: string;
  source_type: string;
  source_id: number | null;
  link: NotificationLink | null;
  responsible_user_id?: number | null;
}

export interface GenContext {
  today: string;
  now: string;
  setting: (type: string) => EventSetting;
}

export type Generator = { name: string; types: string[]; run: (db: DB, ctx: GenContext) => Candidate[] };

const br = (d: string | null | undefined) => formatDateBR(d);
/** Antecedência aplicável: menor prazo configurado que ainda cobre os dias restantes (robusto a dias sem processamento). */
const leadFor = (daysLeft: number, leads: number[] | null) => {
  const ls = [...(leads || [])].filter((l) => l > 0).sort((a, b) => a - b);
  return ls.find((l) => daysLeft <= l) ?? null;
};
const maxLead = (leads: number[] | null) => Math.max(0, ...(leads || []));
const olderThanDays = (iso: string | null, days: number, now: string) => !!iso && Date.parse(now) - Date.parse(iso.includes('T') ? iso : iso + 'T00:00:00Z') >= days * 86_400_000;

// ------------------------------------------------ contratos

const contracts: Generator = {
  name: 'contratos',
  types: ['contrato.vencendo', 'contrato.vence_hoje', 'contrato.vencido', 'contrato.devolucao_hoje', 'contrato.devolucao_atrasada', 'contrato.pendencia_operacional', 'contrato.pendencia_financeira'],
  run(db, { today, setting }) {
    const out: Candidate[] = [];
    const base = (c: any) => ({ source_module: 'contratos', source_type: 'contrato', source_id: c.id, link: { module: 'contratos', page: 'detalhe', id: c.id } as NotificationLink, responsible_user_id: c.responsible_user_id });
    const sel = `SELECT c.id, c.contract_number, c.end_date, c.status, c.responsible_user_id, json_extract(c.customer_snapshot, '$.name') AS customer FROM contracts c`;
    const leads = setting('contrato.vencendo').leads;
    for (const c of db.prepare(`${sel} WHERE c.status IN ('ativo','agendado') AND c.end_date IS NOT NULL AND c.end_date >= ? AND c.end_date <= ?`).all(today, addDaysISO(today, maxLead(leads))) as any[]) {
      const left = daysBetween(today, c.end_date);
      if (left === 0) {
        out.push({ ...base(c), event_type: 'contrato.vence_hoje', key: `contrato.vence_hoje:${c.id}:${c.end_date}`, title: `Contrato ${c.contract_number} vence hoje`, message: `${c.customer} — término (dia da devolução) hoje, ${br(c.end_date)}.` });
        continue;
      }
      const lead = leadFor(left, leads);
      if (lead) out.push({ ...base(c), event_type: 'contrato.vencendo', key: `contrato.vencendo:${c.id}:${c.end_date}:${lead}`, title: `Contrato ${c.contract_number} vence em ${left} dia(s)`, message: `${c.customer} — término em ${br(c.end_date)}. Prorrogue, renove ou programe a retirada.` });
    }
    for (const c of db.prepare(`${sel} WHERE c.status = 'vencido'`).all() as any[])
      out.push({ ...base(c), event_type: 'contrato.vencido', key: `contrato.vencido:${c.id}:${c.end_date}`, title: `Contrato ${c.contract_number} vencido`, message: `${c.customer} — prazo encerrado em ${br(c.end_date)} sem prorrogação ou encerramento registrado.` });
    const rentals = db
      .prepare(`SELECT r.contract_id AS id, MIN(r.end_date) AS end_date, SUM(r.quantity) AS qty, c.contract_number, c.responsible_user_id, json_extract(c.customer_snapshot, '$.name') AS customer FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id WHERE r.status = 'em_uso' AND r.end_date <= ? GROUP BY r.contract_id`)
      .all(today) as any[];
    for (const c of rentals) {
      if (c.end_date === today) out.push({ ...base(c), event_type: 'contrato.devolucao_hoje', key: `contrato.devolucao_hoje:${c.id}:${today}`, title: `Devolução prevista hoje — ${c.contract_number}`, message: `${c.customer} — ${c.qty} unidade(s) com término hoje.` });
      else out.push({ ...base(c), event_type: 'contrato.devolucao_atrasada', key: `contrato.devolucao_atrasada:${c.id}:${c.end_date}`, title: `Devolução atrasada — ${c.contract_number}`, message: `${c.customer} — equipamentos com o cliente desde o término em ${br(c.end_date)} (${daysBetween(c.end_date, today)} dia(s) de atraso).` });
    }
    // pendência operacional real: encerramento aguardando devolução ou devolvido aguardando conferência (inclusive contrato encerrado)
    const ops = db
      .prepare(
        `${sel} WHERE c.status = 'pendente_devolucao'
         OR EXISTS (SELECT 1 FROM contract_operation_items oi JOIN contract_operations o ON o.id = oi.operation_id JOIN stock_assets a ON a.id = oi.asset_id
                    WHERE o.contract_id = c.id AND o.operation_type = 'devolucao' AND a.operational_status = 'aguardando_inspecao'
                      AND NOT EXISTS (SELECT 1 FROM stock_reservations r WHERE r.asset_id = a.id AND r.status = 'em_uso'))`
      )
      .all() as any[];
    for (const c of ops)
      out.push({ ...base(c), event_type: 'contrato.pendencia_operacional', key: `contrato.pendencia_operacional:${c.id}`, title: `Pendência operacional — ${c.contract_number}`, message: `${c.customer} — ${c.status === 'pendente_devolucao' ? 'encerramento aguardando a devolução dos equipamentos' : 'equipamento devolvido aguardando conferência'}.` });
    const fin = db
      .prepare(
        `SELECT c.id, c.contract_number, c.responsible_user_id, json_extract(c.customer_snapshot, '$.name') AS customer, COUNT(*) AS n, MIN(i.due_date) AS oldest
         FROM contract_charges ch JOIN contracts c ON c.id = ch.contract_id JOIN financial_installments i ON i.entry_id = ch.financial_entry_id JOIN financial_entries e ON e.id = ch.financial_entry_id
         WHERE ch.status = 'gerado' AND e.status = 'ativo' AND i.status IN ('aberto','parcial') AND i.due_date < ? GROUP BY c.id`
      )
      .all(today) as any[];
    for (const c of fin)
      out.push({ ...base(c), event_type: 'contrato.pendencia_financeira', key: `contrato.pendencia_financeira:${c.id}:${c.oldest}`, title: `Cobrança vencida — ${c.contract_number}`, message: `${c.customer} — ${c.n} cobrança(s) vencida(s) desde ${br(c.oldest)}.` });
    return out;
  },
};

// ------------------------------------------------ financeiro

const finance: Generator = {
  name: 'financeiro',
  types: ['financeiro.receber_vencendo', 'financeiro.receber_hoje', 'financeiro.receber_vencido', 'financeiro.pagar_vencendo', 'financeiro.pagar_hoje', 'financeiro.pagar_vencido'],
  run(db, { today, setting }) {
    const out: Candidate[] = [];
    const horizon = addDaysISO(today, Math.max(maxLead(setting('financeiro.receber_vencendo').leads), maxLead(setting('financeiro.pagar_vencendo').leads)));
    // pendente = parcela aberta/parcial de título ativo; liquidada, cancelada ou estornada-e-cancelada não entra
    const rows = db
      .prepare(
        `SELECT i.id, i.number, i.due_date, i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount AS pending, e.id AS entry_id, e.entry_number, e.entry_type, e.party_name,
           (SELECT COUNT(*) FROM financial_installments x WHERE x.entry_id = e.id) AS total
         FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id
         WHERE e.status IN ('ativo','aguardando_aprovacao') AND i.status IN ('aberto','parcial') AND i.due_date <= ?`
      )
      .all(horizon) as any[];
    for (const r of rows) {
      const kind = r.entry_type === 'receber' ? 'receber' : 'pagar';
      const what = `${r.entry_number}${r.total > 1 ? ` — parcela ${r.number}/${r.total}` : ''} — ${r.party_name} — ${formatBRL(r.pending)}`;
      const base = { source_module: 'financeiro', source_type: 'parcela', source_id: r.id, link: { module: 'financeiro', page: 'titulo', id: r.entry_id } as NotificationLink };
      const left = daysBetween(today, r.due_date);
      if (left < 0) out.push({ ...base, event_type: `financeiro.${kind}_vencido`, key: `financeiro.${kind}_vencido:${r.id}:${r.due_date}`, title: kind === 'receber' ? 'Conta a receber vencida' : 'Conta a pagar vencida', message: `${what} — venceu em ${br(r.due_date)} (${-left} dia(s)).` });
      else if (left === 0) out.push({ ...base, event_type: `financeiro.${kind}_hoje`, key: `financeiro.${kind}_hoje:${r.id}:${r.due_date}`, title: kind === 'receber' ? 'Recebimento previsto para hoje' : 'Pagamento previsto para hoje', message: `${what} — vencimento hoje (ainda não liquidado).` });
      else {
        const lead = leadFor(left, setting(`financeiro.${kind}_vencendo`).leads);
        if (lead) out.push({ ...base, event_type: `financeiro.${kind}_vencendo`, key: `financeiro.${kind}_vencendo:${r.id}:${r.due_date}:${lead}`, title: kind === 'receber' ? `Conta a receber vence em ${left} dia(s)` : `Conta a pagar vence em ${left} dia(s)`, message: `${what} — vencimento em ${br(r.due_date)}.` });
      }
    }
    return out;
  },
};

// ------------------------------------------------ estoque

const stock: Generator = {
  name: 'estoque',
  types: ['estoque.abaixo_minimo', 'estoque.sem_saldo', 'estoque.reserva_hoje', 'estoque.indisponivel', 'estoque.aguardando_inspecao'],
  run(db, { today, now, setting }) {
    const out: Candidate[] = [];
    // só itens controlados por quantidade (patrimônio individual não tem "estoque baixo")
    const items = db
      .prepare(
        `SELECT i.id, i.internal_code, i.description, i.unit, i.min_qty, COALESCE(SUM(b.quantity - b.reserved - b.unavailable),0) AS available
         FROM catalog_items i LEFT JOIN stock_balances b ON b.item_id = i.id
         WHERE i.active = 1 AND i.tracking = 'quantidade' AND EXISTS (SELECT 1 FROM stock_movements m WHERE m.item_id = i.id)
         GROUP BY i.id`
      )
      .all() as any[];
    for (const i of items) {
      const base = { source_module: 'estoque', source_type: 'item', source_id: i.id, link: { module: 'estoque', page: 'item', id: i.id } as NotificationLink };
      if (i.available <= 0) out.push({ ...base, event_type: 'estoque.sem_saldo', key: `estoque.sem_saldo:${i.id}`, title: `Sem saldo disponível — ${i.internal_code}`, message: `${i.description}: nenhuma unidade disponível (considerando reservas e indisponíveis).` });
      else if (i.min_qty !== null && i.available < i.min_qty) out.push({ ...base, event_type: 'estoque.abaixo_minimo', key: `estoque.abaixo_minimo:${i.id}`, title: `Estoque abaixo do mínimo — ${i.internal_code}`, message: `${i.description}: disponível ${i.available} ${i.unit}, mínimo ${i.min_qty}.` });
    }
    for (const r of db.prepare(`SELECT r.id, r.number, r.contract_ref, r.customer_name, i.internal_code, a.asset_tag, r.quantity FROM stock_reservations r JOIN catalog_items i ON i.id = r.item_id LEFT JOIN stock_assets a ON a.id = r.asset_id WHERE r.status = 'confirmada' AND r.start_date = ?`).all(today) as any[])
      out.push({ event_type: 'estoque.reserva_hoje', key: `estoque.reserva_hoje:${r.id}:${today}`, title: `Reserva começa hoje — ${r.asset_tag || r.internal_code}`, message: `${r.number}${r.contract_ref ? ` (${r.contract_ref})` : ''} — ${r.customer_name || ''}${r.asset_tag ? '' : ` — ${r.quantity} un.`}. Ainda não entregue.`, source_module: 'estoque', source_type: 'reserva', source_id: r.id, link: { module: 'estoque', page: 'disponibilidade' } });
    const insp = setting('estoque.aguardando_inspecao').inactivity_days ?? 1;
    for (const a of db.prepare(`SELECT a.id, a.asset_tag, a.operational_status, a.updated_at, i.description FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id WHERE a.operational_status IN ('em_manutencao','danificado','aguardando_inspecao')`).all() as any[]) {
      const base = { source_module: 'estoque', source_type: 'patrimonio', source_id: a.id, link: { module: 'estoque', page: 'ativo', id: a.id } as NotificationLink };
      if (a.operational_status === 'aguardando_inspecao') {
        if (olderThanDays(a.updated_at, insp, now)) out.push({ ...base, event_type: 'estoque.aguardando_inspecao', key: `estoque.aguardando_inspecao:${a.id}:${a.updated_at.slice(0, 10)}`, title: `${a.asset_tag} aguardando inspeção`, message: `${a.description} — retornou e ainda não foi conferido; indisponível para locação.` });
      } else out.push({ ...base, event_type: 'estoque.indisponivel', key: `estoque.indisponivel:${a.id}:${a.operational_status}`, title: `${a.asset_tag} indisponível`, message: `${a.description} — ${a.operational_status === 'danificado' ? 'danificado (bloqueado)' : 'em manutenção'}.` });
    }
    return out;
  },
};

// ------------------------------------------------ ordens de serviço

const workOrders: Generator = {
  name: 'manutencao',
  types: ['os.nova', 'os.atribuida', 'os.sem_movimentacao', 'os.prazo_proximo', 'os.atrasada', 'os.equipamento_liberado', 'os.equipamento_parado', 'os.encerrada_pendencias'],
  run(db, { today, now, setting }) {
    const out: Candidate[] = [];
    const recent = addDaysISO(today, -3);
    const base = (o: any) => ({ source_module: 'os', source_type: 'os', source_id: o.id, link: { module: 'os', page: 'detalhe', id: o.id } as NotificationLink, responsible_user_id: o.responsible_user_id });
    const sel = `SELECT w.id, w.order_number, w.title, w.status, w.status_since, w.due_date, w.responsible_user_id, w.created_at, w.blocks_equipment, w.downtime_start, w.downtime_end, w.completed_at, w.asset_id,
      json_extract(w.asset_snapshot, '$.asset_tag') AS tag FROM work_orders w`;
    const open = db.prepare(`${sel} WHERE w.status NOT IN ('concluida','cancelada')`).all() as any[];
    const inactivity = setting('os.sem_movimentacao').inactivity_days ?? 3;
    const leads = setting('os.prazo_proximo').leads;
    const parked = setting('os.equipamento_parado').inactivity_days ?? 5;
    for (const o of open) {
      if (o.created_at.slice(0, 10) >= recent) out.push({ ...base(o), event_type: 'os.nova', key: `os.nova:${o.id}`, title: `Nova OS ${o.order_number}`, message: `${o.tag} — ${o.title}.` });
      if (o.responsible_user_id) out.push({ ...base(o), event_type: 'os.atribuida', key: `os.atribuida:${o.id}:${o.responsible_user_id}`, title: `OS ${o.order_number} atribuída a você`, message: `${o.tag} — ${o.title}${o.due_date ? ` (prazo ${br(o.due_date)})` : ''}.` });
      if (olderThanDays(o.status_since, inactivity, now)) out.push({ ...base(o), event_type: 'os.sem_movimentacao', key: `os.sem_movimentacao:${o.id}:${o.status_since}`, title: `OS ${o.order_number} sem movimentação`, message: `${o.tag} — no mesmo status desde ${br(o.status_since.slice(0, 10))}.` });
      if (o.due_date) {
        const left = daysBetween(today, o.due_date);
        if (left < 0) out.push({ ...base(o), event_type: 'os.atrasada', key: `os.atrasada:${o.id}:${o.due_date}`, title: `OS ${o.order_number} atrasada`, message: `${o.tag} — prazo previsto ${br(o.due_date)}.` });
        else {
          const lead = left === 0 ? 0 : leadFor(left, leads);
          if (lead !== null) out.push({ ...base(o), event_type: 'os.prazo_proximo', key: `os.prazo_proximo:${o.id}:${o.due_date}:${lead}`, title: left === 0 ? `OS ${o.order_number} vence hoje` : `OS ${o.order_number} vence em ${left} dia(s)`, message: `${o.tag} — ${o.title}.` });
        }
      }
      if (o.blocks_equipment && olderThanDays(o.downtime_start, parked, now)) out.push({ ...base(o), event_type: 'os.equipamento_parado', key: `os.equipamento_parado:${o.id}`, title: `${o.tag} parado por manutenção`, message: `OS ${o.order_number} mantém o equipamento indisponível desde ${br(o.downtime_start?.slice(0, 10))}.` });
    }
    const closedGrace = setting('os.encerrada_pendencias').inactivity_days ?? 1;
    for (const o of db.prepare(`${sel} WHERE w.status = 'concluida' AND substr(w.completed_at,1,10) >= ?`).all(addDaysISO(today, -60)) as any[]) {
      if (o.downtime_end && o.downtime_end.slice(0, 10) >= recent) out.push({ ...base(o), event_type: 'os.equipamento_liberado', key: `os.equipamento_liberado:${o.id}`, title: `${o.tag} liberado após manutenção`, message: `OS ${o.order_number} concluída e equipamento aprovado na inspeção.` });
      if (!olderThanDays(o.completed_at, closedGrace, now)) continue;
      const notReleased = o.blocks_equipment && !o.downtime_end && (db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(o.asset_id) as any)?.operational_status === 'aguardando_inspecao';
      const srv = (db.prepare("SELECT COUNT(*) n FROM work_order_services WHERE work_order_id = ? AND status = 'concluido' AND financial_entry_id IS NULL").get(o.id) as { n: number }).n;
      if (notReleased || srv) out.push({ ...base(o), event_type: 'os.encerrada_pendencias', key: `os.encerrada_pendencias:${o.id}`, title: `OS ${o.order_number} encerrada com pendências`, message: [notReleased && 'equipamento ainda não liberado (inspeção)', srv && `${srv} serviço(s) de terceiro não enviado(s) ao Financeiro`].filter(Boolean).join('; ') + '.' });
    }
    return out;
  },
};

// ------------------------------------------------ entregas e devoluções

const logistics: Generator = {
  name: 'logistica',
  types: ['logistica.entrega_hoje', 'logistica.entrega_proxima', 'logistica.entrega_atrasada', 'logistica.retirada_hoje', 'logistica.retirada_proxima', 'logistica.retirada_atrasada', 'logistica.documento_pendente', 'logistica.avaria', 'logistica.aguardando_inspecao'],
  run(db, { today, now, setting }) {
    const out: Candidate[] = [];
    const base = (o: any) => ({ source_module: 'logistica', source_type: 'operacao', source_id: o.id, link: { module: 'logistica', page: 'detalhe', id: o.id } as NotificationLink, responsible_user_id: o.responsible_user_id });
    const ops = db
      .prepare(
        `SELECT o.id, o.number, o.op_type, o.status, o.scheduled_at, o.completed_at, o.responsible_user_id, o.address, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer
         FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id WHERE o.status NOT IN ('concluida','cancelada')`
      )
      .all() as any[];
    const pending = { entrega: ['rascunho', 'programada', 'em_separacao', 'pronta', 'em_transporte'], retorno: ['rascunho', 'programada', 'em_andamento'] };
    const docGrace = setting('logistica.documento_pendente').inactivity_days ?? 1;
    for (const o of ops) {
      const kind = o.op_type === 'entrega' ? 'entrega' : 'retirada';
      const label = o.op_type === 'entrega' ? 'Entrega' : o.op_type === 'retirada' ? 'Retirada' : 'Devolução';
      const desc = `${o.customer} — contrato ${o.contract_number}${o.address ? ` — ${o.address}` : ''}`;
      if ((o.op_type === 'entrega' ? pending.entrega : pending.retorno).includes(o.status)) {
        const date = o.scheduled_at.slice(0, 10);
        if (o.scheduled_at < now) out.push({ ...base(o), event_type: `logistica.${kind}_atrasada`, key: `logistica.${kind}_atrasada:${o.id}:${o.scheduled_at}`, title: `${label} atrasada — ${o.number}`, message: `${desc}. Programada para ${new Date(o.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}.` });
        else if (date === today) out.push({ ...base(o), event_type: `logistica.${kind}_hoje`, key: `logistica.${kind}_hoje:${o.id}:${date}`, title: `${label} hoje — ${o.number}`, message: `${desc}. Às ${new Date(o.scheduled_at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.` });
        else {
          const left = daysBetween(today, date);
          const lead = leadFor(left, setting(`logistica.${kind}_proxima`).leads);
          if (lead) out.push({ ...base(o), event_type: `logistica.${kind}_proxima`, key: `logistica.${kind}_proxima:${o.id}:${date}:${lead}`, title: `${label} em ${left} dia(s) — ${o.number}`, message: `${desc}. Em ${br(date)}.` });
        }
      }
      if (['entregue', 'entregue_parcialmente'].includes(o.status) && olderThanDays(o.completed_at, docGrace, now) && !db.prepare("SELECT 1 FROM logistics_attachments WHERE order_id = ? AND phase IN ('entrega','documento')").get(o.id))
        out.push({ ...base(o), event_type: 'logistica.documento_pendente', key: `logistica.documento_pendente:${o.id}`, title: `Comprovante pendente — ${o.number}`, message: `${desc}. Entrega concluída sem comprovante ou foto anexada.` });
      if (o.op_type !== 'entrega' && db.prepare('SELECT 1 FROM logistics_order_items WHERE order_id = ? AND quantity_processed - quantity_inspected > 0.0000001').get(o.id))
        out.push({ ...base(o), event_type: 'logistica.aguardando_inspecao', key: `logistica.aguardando_inspecao:${o.id}`, title: `Itens aguardando inspeção — ${o.number}`, message: `${desc}. Equipamentos recebidos ainda não liberados.` });
    }
    for (const x of db
      .prepare(`SELECT oc.id, oc.number, oc.order_id, oc.occurrence_type, oc.description, c.contract_number, o.responsible_user_id FROM logistics_occurrences oc JOIN contracts c ON c.id = oc.contract_id LEFT JOIN logistics_orders o ON o.id = oc.order_id WHERE oc.status = 'registrada'`)
      .all() as any[])
      out.push({
        event_type: 'logistica.avaria', key: `logistica.avaria:${x.id}`, title: `${x.occurrence_type === 'divergencia' ? 'Divergência' : x.occurrence_type === 'acessorio_faltante' ? 'Acessório faltante' : 'Avaria'} — ${x.number}`,
        message: `Contrato ${x.contract_number}: ${x.description} Aguardando análise.`, source_module: 'logistica', source_type: 'ocorrencia', source_id: x.id,
        link: x.order_id ? { module: 'logistica', page: 'detalhe', id: x.order_id } : { module: 'logistica', page: 'ocorrencias' }, responsible_user_id: x.responsible_user_id,
      });
    return out;
  },
};

// ------------------------------------------------ orçamentos

const quotations: Generator = {
  name: 'orcamentos',
  types: ['orcamento.aguardando_aprovacao', 'orcamento.aguardando_resposta', 'orcamento.vencendo', 'orcamento.vencido', 'orcamento.aprovado_sem_contrato', 'orcamento.convertido'],
  run(db, { today, now, setting }) {
    const out: Candidate[] = [];
    const recent = addDaysISO(today, -7);
    const rows = db
      .prepare(
        `SELECT q.id, q.quotation_number, q.status, q.expiration_date, q.sent_at, q.updated_at, q.version, q.responsible_user_id, q.converted_record_type, q.converted_record_id, json_extract(q.customer_snapshot, '$.name') AS customer
         FROM quotations q WHERE q.status IN ('aguardando_aprovacao','aprovado_interno','enviado','em_negociacao','aprovado_cliente') OR (q.status IN ('expirado','convertido') AND substr(q.updated_at,1,10) >= ?)`
      )
      .all(recent) as any[];
    const follow = setting('orcamento.aguardando_resposta').inactivity_days ?? 3;
    const approved = setting('orcamento.aprovado_sem_contrato').inactivity_days ?? 2;
    const leads = setting('orcamento.vencendo').leads;
    for (const q of rows) {
      const base = { source_module: 'orcamentos', source_type: 'orcamento', source_id: q.id, link: { module: 'orcamentos', page: 'detalhe', id: q.id } as NotificationLink, responsible_user_id: q.responsible_user_id };
      if (q.status === 'aguardando_aprovacao') out.push({ ...base, event_type: 'orcamento.aguardando_aprovacao', key: `orcamento.aguardando_aprovacao:${q.id}:${q.version}`, title: `Orçamento ${q.quotation_number} aguardando aprovação`, message: `${q.customer} — aprovação interna pendente.` });
      if (['enviado', 'em_negociacao'].includes(q.status) && olderThanDays(q.sent_at, follow, now)) out.push({ ...base, event_type: 'orcamento.aguardando_resposta', key: `orcamento.aguardando_resposta:${q.id}:${q.sent_at}`, title: `Orçamento ${q.quotation_number} sem resposta`, message: `${q.customer} — enviado em ${br(q.sent_at?.slice(0, 10))}. Faça o acompanhamento comercial.` });
      if (['aprovado_interno', 'enviado', 'em_negociacao'].includes(q.status)) {
        const left = daysBetween(today, q.expiration_date);
        const lead = left >= 0 ? (left === 0 ? 0 : leadFor(left, leads)) : null;
        if (lead !== null) out.push({ ...base, event_type: 'orcamento.vencendo', key: `orcamento.vencendo:${q.id}:${q.expiration_date}:${lead}`, title: left === 0 ? `Orçamento ${q.quotation_number} vence hoje` : `Orçamento ${q.quotation_number} vence em ${left} dia(s)`, message: `${q.customer} — validade ${br(q.expiration_date)}.` });
      }
      if (q.status === 'expirado') out.push({ ...base, event_type: 'orcamento.vencido', key: `orcamento.vencido:${q.id}:${q.expiration_date}`, title: `Orçamento ${q.quotation_number} venceu sem resposta`, message: `${q.customer} — validade encerrada em ${br(q.expiration_date)}. Renove ou registre o resultado.` });
      if (q.status === 'aprovado_cliente' && olderThanDays(q.updated_at, approved, now)) out.push({ ...base, event_type: 'orcamento.aprovado_sem_contrato', key: `orcamento.aprovado_sem_contrato:${q.id}`, title: `Orçamento ${q.quotation_number} aprovado aguardando conversão`, message: `${q.customer} — aprovado pelo cliente e ainda não convertido em venda/contrato.` });
      if (q.status === 'convertido') out.push({ ...base, event_type: 'orcamento.convertido', key: `orcamento.convertido:${q.id}`, title: `Orçamento ${q.quotation_number} convertido`, message: `${q.customer} — convertido em ${q.converted_record_type === 'venda' ? 'venda' : 'contrato'} ${q.converted_record_id}.` });
    }
    return out;
  },
};

export const GENERATORS: Generator[] = [contracts, finance, stock, workOrders, logistics, quotations];
