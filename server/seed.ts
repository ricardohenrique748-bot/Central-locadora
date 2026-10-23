/**
 * Carga inicial: usuário administrador, clientes e equipamentos já usados no ERP, modelos de texto.
 * Só roda em banco vazio.
 */

import { DB, transaction } from './db';
import { clientesIniciais, equipamentosIniciais, estoqueGranelInicial, patrimoniosIniciais } from '../src/data/mockData';
import { isValidCNPJ, isValidCPF, onlyDigits } from '../shared/orcamentos/validators';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { applyMovement, assetEvent, nextNumber, refreshAssetRental } from './services/stock/core';
import { seedFinanceIfEmpty } from './services/finance/registry';
import { seedOsIfEmpty } from './services/os/core';

const ADMIN = {
  name: 'Ricardo Luz (Lynus)',
  email: 'ricardoluz@lynustech.com.br',
  // scrypt da senha definida pelo usuário — a senha em si não fica no código
  password_hash:
    'scrypt$16384$09mfiZoSEAvW1sLU4dVwmg==$HPBBuGHP1OgXUlmjAK3XS4mSrqlHDcwGUS956oBEyL7Z1RJl9HIyqowjpgnhHK4u4Fe2QJvfvCzEBWWps6Ryqw==',
};

const CATEGORY_LABELS: Record<string, string> = {
  andaimes: 'Andaimes',
  escoramento: 'Escoramento',
  ferramentas_eletricas: 'Ferramentas elétricas',
  concreto: 'Concreto',
  compactacao: 'Compactação',
  acessorios: 'Acessórios',
};

const TEMPLATES: { field: string; title: string; body: string; type: 'venda' | 'locacao' | null }[] = [
  { field: 'payment_terms', title: 'À vista / PIX', body: 'Pagamento à vista via PIX ou transferência bancária na confirmação do pedido.', type: null },
  { field: 'payment_terms', title: 'Boleto 28 dias', body: 'Pagamento via boleto bancário com vencimento em 28 dias após a emissão da nota.', type: 'venda' },
  { field: 'payment_terms', title: 'Locação mensal antecipada', body: 'Pagamento antecipado do primeiro período; demais períodos faturados no dia de corte do cliente.', type: 'locacao' },
  { field: 'warranty_terms', title: 'Garantia de fábrica', body: 'Garantia do fabricante contra defeitos de fabricação, conforme manual do produto. Não cobre mau uso, quedas ou ligação em tensão incorreta.', type: 'venda' },
  { field: 'customer_responsibilities', title: 'Conservação dos equipamentos', body: 'O locatário é responsável pela guarda, conservação e uso adequado dos equipamentos durante todo o período de locação, respondendo por danos, perdas ou extravios.', type: 'locacao' },
  { field: 'return_conditions', title: 'Devolução padrão', body: 'Os equipamentos devem ser devolvidos limpos e nas mesmas condições em que foram retirados. Itens faltantes ou danificados serão cobrados pelo valor de reposição.', type: 'locacao' },
  { field: 'pickup_delivery_terms', title: 'Entrega pela locadora', body: 'Entrega e retirada realizadas pela Central Locadora no endereço da obra, em horário comercial, mediante agendamento prévio.', type: null },
  { field: 'delivery_terms', title: 'Pronta entrega', body: 'Pronta entrega, sujeita à confirmação de estoque no momento do pedido.', type: 'venda' },
];

export function seedIfEmpty(db: DB) {
  const hasUsers = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0;
  if (hasUsers) return;

  transaction(db, () => {
    const admin = db
      .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin') RETURNING id")
      .get(ADMIN.name, ADMIN.email, ADMIN.password_hash) as { id: number };

    const insCustomer = db.prepare(
      `INSERT INTO customers (person_type, name, trade_name, document, state_registration, phone, email, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of clientesIniciais) {
      const doc = onlyDigits(c.cpfCnpj);
      const valid = c.tipo === 'PJ' ? isValidCNPJ(doc) : isValidCPF(doc);
      insCustomer.run(
        c.tipo,
        c.nomeRazao,
        c.nomeFantasia || null,
        valid ? doc : null,
        c.tipo === 'PJ' ? c.rgIe || null : null,
        onlyDigits(c.telefone) || null,
        c.email || null,
        valid ? c.observacoes || null : [c.observacoes, `Documento importado inválido (${c.cpfCnpj}) — conferir cadastro.`].filter(Boolean).join('\n'),
        admin.id
      );
    }

    const insItem = db.prepare(
      `INSERT INTO catalog_items (internal_code, description, category, kind, item_type, sale_enabled, rental_enabled, unit,
         daily_rental_price, weekly_rental_price, monthly_rental_price, technical_description)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`
    );
    const cents = (v: number) => Math.round(v * 100);
    for (const e of equipamentosIniciais) {
      insItem.run(
        e.codigo,
        e.nome,
        CATEGORY_LABELS[e.categoria] || e.categoria,
        e.categoria === 'acessorios' ? 'acessorio' : 'equipamento_locacao',
        e.categoria === 'acessorios' ? 'acessorio' : 'equipamento',
        e.unidadeMedida,
        cents(e.valorDiaria),
        cents(e.valorSemanal),
        cents(e.valorMensal),
        e.descricao
      );
    }

    const insTpl = db.prepare('INSERT INTO text_templates (field, title, body, quotation_type) VALUES (?, ?, ?, ?)');
    for (const t of TEMPLATES) insTpl.run(t.field, t.title, t.body, t.type);
  });
}

/**
 * Carga inicial do estoque a partir dos dados que existiam na aba antiga "Estoque & Patrimônios":
 * saldos a granel, patrimônios individuais e o que estava alugado. Roda uma única vez (estoque vazio).
 * Custo inicial estimado pelo valor de reposição cadastrado no sistema anterior.
 */
export function seedStockIfEmpty(db: DB) {
  const hasLocations = (db.prepare('SELECT COUNT(*) n FROM stock_locations').get() as { n: number }).n > 0;
  const hasStock = (db.prepare('SELECT (SELECT COUNT(*) FROM stock_movements) + (SELECT COUNT(*) FROM stock_assets) n').get() as { n: number }).n > 0;
  if (hasLocations && hasStock) return;

  transaction(db, () => {
    if (!hasLocations) {
      const ins = db.prepare('INSERT INTO stock_locations (code, name, location_type, address, responsible) VALUES (?, ?, ?, ?, ?)');
      ins.run('DEP-01', 'Depósito principal', 'deposito', 'Av. Bady Bassitt, 4820 – São José do Rio Preto/SP', null);
      ins.run('PAT-01', 'Pátio de equipamentos', 'patio', 'Av. Bady Bassitt, 4820 – São José do Rio Preto/SP', null);
      ins.run('OFI-01', 'Oficina de manutenção', 'oficina', 'Av. Bady Bassitt, 4820 – São José do Rio Preto/SP', null);
    }
    if (hasStock) return;
    const dep = (db.prepare("SELECT id FROM stock_locations WHERE code = 'DEP-01'").get() as { id: number } | undefined)?.id;
    const ofi = (db.prepare("SELECT id FROM stock_locations WHERE code = 'OFI-01'").get() as { id: number } | undefined)?.id ?? dep;
    if (!dep) return;
    const ofiId: number = ofi ?? dep;
    const today = todayISO();
    const ref = 'Implantação inicial (dados do sistema anterior)';

    for (const e of equipamentosIniciais) {
      const item = db.prepare('SELECT id FROM catalog_items WHERE internal_code = ?').get(e.codigo) as { id: number } | undefined;
      if (!item) continue;
      const cost = Math.round(e.valorReposicaoIndenizacao * 100);
      const serial = e.tipoControle === 'serializado';
      db.prepare('UPDATE catalog_items SET tracking = ?, acquisition_cost = ?, average_cost = ?, default_location_id = ? WHERE id = ?').run(serial ? 'individual' : 'quantidade', cost, cost, dep, item.id);

      if (!serial) {
        const g = estoqueGranelInicial.find((x) => x.equipamentoId === e.id);
        if (!g) continue;
        const unavailable = g.emManutencao + g.emTeste;
        const total = g.disponivel + g.locado + unavailable;
        if (total <= 0) continue;
        applyMovement(db, null, { type: 'entrada_inicial', item_id: item.id, quantity: total, location_id: dep, qty_delta: total, dest_location_id: dep, unit_cost: cost, reference_doc: ref });
        if (unavailable > 0) {
          applyMovement(db, null, { type: 'envio_manutencao', item_id: item.id, quantity: unavailable, location_id: dep, qty_delta: 0, unavailable_delta: unavailable, origin_location_id: dep, reason: 'Em manutenção/teste no sistema anterior', reference_doc: ref });
        }
        if (g.locado > 0) {
          const r = db
            .prepare(
              `INSERT INTO stock_reservations (number, item_id, quantity, start_date, end_date, status, customer_name, location_id, delivered_at, notes)
               VALUES (?, ?, ?, ?, ?, 'em_uso', 'Clientes diversos (importado)', ?, ?, 'Quantidade que constava como locada no sistema anterior. Ajuste cliente e datas quando o módulo de Contratos for integrado.') RETURNING id`
            )
            .get(nextNumber(db, 'RES'), item.id, g.locado, addDaysISO(today, -15), addDaysISO(today, 15), dep, new Date().toISOString()) as { id: number };
          applyMovement(db, null, { type: 'saida_locacao', item_id: item.id, quantity: g.locado, location_id: dep, qty_delta: -g.locado, origin_location_id: dep, reference_doc: ref, document_type: 'reserva', document_id: r.id });
        }
        continue;
      }

      for (const p of patrimoniosIniciais.filter((x) => x.equipamentoId === e.id)) {
        const op = p.status === 'em_manutencao' ? 'em_manutencao' : p.status === 'em_teste' ? 'aguardando_inspecao' : p.status === 'baixado' ? 'baixado' : 'operacional';
        const loc: number = op === 'em_manutencao' ? ofiId : dep;
        const a = db
          .prepare(
            `INSERT INTO stock_assets (item_id, asset_tag, acquisition_date, acquisition_cost, conservation, location_id, operational_status, rental_status, technical_notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'disponivel', ?) RETURNING id`
          )
          .get(item.id, p.numeroSerie, `${p.anoFabricacao}-01-01`, cost, p.horasUso > 500 ? 'regular' : 'bom', loc, op, `${p.horasUso} horas de uso${p.ultimaManutencao ? `; última manutenção ${p.ultimaManutencao}` : ''} (sistema anterior)`) as { id: number };
        applyMovement(db, null, { type: 'entrada_inicial', item_id: item.id, asset_id: a.id, quantity: 1, location_id: loc, qty_delta: 1, dest_location_id: loc, unit_cost: cost, reference_doc: ref });
        assetEvent(db, a.id, 'cadastro', 'Equipamento importado do sistema anterior.', null);
        if (p.status === 'locado') {
          const r = db
            .prepare(
              `INSERT INTO stock_reservations (number, item_id, asset_id, quantity, start_date, end_date, status, customer_name, location_id, delivered_at, notes)
               VALUES (?, ?, ?, 1, ?, ?, 'em_uso', ?, ?, ?, 'Locação ativa importada do sistema anterior.') RETURNING id`
            )
            .get(nextNumber(db, 'RES'), item.id, a.id, addDaysISO(today, -15), addDaysISO(today, 15), p.localizacaoObra || 'Cliente (importado)', loc, new Date().toISOString()) as { id: number };
          applyMovement(db, null, { type: 'saida_locacao', item_id: item.id, asset_id: a.id, quantity: 1, location_id: loc, qty_delta: -1, origin_location_id: loc, reference_doc: ref, document_type: 'reserva', document_id: r.id });
          assetEvent(db, a.id, 'entrega', `Em locação: ${p.localizacaoObra || 'cliente'} (importado).`, null);
        }
        refreshAssetRental(db, a.id);
      }
    }
  });
}

/** Todas as cargas iniciais, na ordem em que dependem umas das outras. */
export function seedAll(db: DB) {
  seedIfEmpty(db);
  seedStockIfEmpty(db);
  seedFinanceIfEmpty(db);
  seedOsIfEmpty(db);
}
