/**
 * Rotas /api/stock. A autenticação é aplicada antes (createApi); permissões nos serviços.
 */

import express, { Response } from 'express';
import { DB, transaction } from './db';
import { badRequest, forbidden, parseId } from './http';
import { stockCan } from '../shared/estoque/rules';
import { MOVEMENT_LABELS, OPERATIONAL_LABELS, RENTAL_LABELS, ITEM_KIND_LABELS } from '../shared/estoque/types';
import { formatDateBR, formatDateTimeBR } from '../shared/orcamentos/dates';
import { createCatalogItem, updateCatalogItem } from './services/catalog';
import { getMovement, listMovements, refreshAllAssets, reverseMovement } from './services/stock/core';
import {
  createSupplier, getStockItemDetail, getStockSettings, listLocations, listStockItems, listSuppliers, saveLocation, saveStockSettings, updateSupplier,
} from './services/stock/registry';
import {
  cancelEntry, changeQuantityStatus, confirmDraftMovement, confirmEntry, createExit, deleteDraftMovement, getEntry, getTransfer, listEntries,
  listTransfers, saveEntry, saveTransfer, transferAction,
} from './services/stock/documents';
import { getInventory, inventoryAction, listInventories, openInventory, saveCounts } from './services/stock/inventory';
import {
  addAssetFile, assetAction, availability, createReservation, getAssetDetail, getAssetFile, inspectAsset, listAssets, listReservations,
  reservationAction, updateAsset,
} from './services/stock/rental';
import { quickSearch, stockDashboard, stockReport } from './services/stock/reports';
import { autoCloseIfReturnedTx } from './services/contracts/closing';
import { AssetAction } from '../shared/estoque/rules';

const csvMoney = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));
const csvNum = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

function sendCsv(res: Response, filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n'));
}

export function createStockApi(db: DB) {
  const r = express.Router();
  const q = (req: express.Request) => req.query as Record<string, string>;

  // a situação "reservado" depende da data: reprocessa ao abrir o painel/listas
  let lastRefresh = '';
  r.use((_req, _res, next) => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastRefresh) {
      refreshAllAssets(db);
      lastRefresh = today;
    }
    next();
  });

  r.get('/dashboard', (req, res) => res.json(stockDashboard(db, q(req))));
  r.get('/search', (req, res) => res.json(quickSearch(db, String(req.query.q || ''))));

  // itens
  r.get('/items', (req, res) => {
    const data = listStockItems(db, q(req));
    if (!stockCan.viewCosts(req.user!)) data.rows.forEach((i) => ((i.acquisition_cost = null), (i.average_cost = null)));
    res.json(data);
  });
  r.get('/items/:id', (req, res) => {
    const d = getStockItemDetail(db, parseId(req.params.id));
    if (!stockCan.viewCosts(req.user!)) Object.assign(d, { acquisition_cost: null, average_cost: null });
    res.json(d);
  });
  r.post('/items', (req, res) => res.status(201).json(createCatalogItem(db, req.user!, req.body)));
  r.put('/items/:id', (req, res) => res.json(updateCatalogItem(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/items/quantity-status', (req, res) => res.status(201).json({ id: changeQuantityStatus(db, req.user!, req.body) }));

  // movimentações
  r.get('/movements', (req, res) => res.json(listMovements(db, q(req))));
  r.get('/movements/export.csv', (req, res) => {
    const { rows } = listMovements(db, { ...q(req), all: '1' });
    sendCsv(
      res,
      'movimentacoes.csv',
      ['Número', 'Data', 'Tipo', 'Status', 'Código', 'Item', 'Patrimônio', 'Quantidade', 'Efeito no saldo', 'Origem', 'Destino', 'Custo unitário (R$)', 'Custo total (R$)', 'Documento', 'Motivo', 'Usuário'],
      rows.map((m) => [
        m.number, formatDateTimeBR(m.created_at), MOVEMENT_LABELS[m.movement_type], m.status, m.item_code, m.item_description, m.asset_tag, csvNum(m.quantity), csvNum(m.qty_delta),
        m.origin_name, m.dest_name, csvMoney(m.unit_cost), csvMoney(m.total_cost), m.reference_doc, m.reason, m.created_by_name,
      ])
    );
  });
  r.get('/movements/:id', (req, res) => res.json(getMovement(db, parseId(req.params.id))));
  r.post('/movements/:id/reverse', (req, res) => res.json(reverseMovement(db, req.user!, parseId(req.params.id), req.body?.reason)));
  r.post('/movements/:id/confirm', (req, res) => {
    confirmDraftMovement(db, req.user!, parseId(req.params.id));
    res.json(getMovement(db, parseId(req.params.id)));
  });
  r.delete('/movements/:id', (req, res) => {
    deleteDraftMovement(db, req.user!, parseId(req.params.id));
    res.json({ ok: true });
  });
  r.post('/exits', (req, res) => res.status(201).json(getMovement(db, createExit(db, req.user!, req.body).id)));

  // entradas
  r.get('/entries', (req, res) => res.json(listEntries(db, q(req))));
  r.get('/entries/:id', (req, res) => res.json(getEntry(db, parseId(req.params.id))));
  r.post('/entries', (req, res) => res.status(201).json(saveEntry(db, req.user!, null, req.body)));
  r.put('/entries/:id', (req, res) => res.json(saveEntry(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/entries/:id/confirm', (req, res) => res.json(confirmEntry(db, req.user!, parseId(req.params.id))));
  r.post('/entries/:id/cancel', (req, res) => res.json(cancelEntry(db, req.user!, parseId(req.params.id))));

  // transferências
  r.get('/transfers', (req, res) => res.json(listTransfers(db, q(req))));
  r.get('/transfers/:id', (req, res) => res.json(getTransfer(db, parseId(req.params.id))));
  r.post('/transfers', (req, res) => res.status(201).json(saveTransfer(db, req.user!, null, req.body)));
  r.put('/transfers/:id', (req, res) => res.json(saveTransfer(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/transfers/:id/:action', (req, res) => res.json(transferAction(db, req.user!, parseId(req.params.id), req.params.action, req.body || {})));

  // inventário
  r.get('/inventories', (_req, res) => res.json(listInventories(db)));
  r.post('/inventories', (req, res) => res.status(201).json(openInventory(db, req.user!, req.body)));
  r.get('/inventories/:id', (req, res) => res.json(getInventory(db, parseId(req.params.id))));
  r.put('/inventories/:id/counts', (req, res) => res.json(saveCounts(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/inventories/:id/:action', (req, res) => res.json(inventoryAction(db, req.user!, parseId(req.params.id), req.params.action, req.body || {})));

  // equipamentos individuais
  r.get('/assets', (req, res) => {
    const data = listAssets(db, q(req));
    if (!stockCan.viewCosts(req.user!)) data.rows.forEach((a) => (a.acquisition_cost = null));
    res.json(data);
  });
  r.get('/assets/:id', (req, res) => {
    const d = getAssetDetail(db, parseId(req.params.id));
    if (!stockCan.viewCosts(req.user!)) d.acquisition_cost = null;
    res.json(d);
  });
  r.put('/assets/:id', (req, res) => res.json(updateAsset(db, req.user!, parseId(req.params.id), req.body)));
  // patrimônio conferido e liberado pode ser o último que faltava para encerrar a locação de origem
  const closeOriginContract = (req: express.Request, assetId: number) => {
    const r = db.prepare("SELECT contract_id FROM stock_reservations WHERE asset_id = ? AND status = 'concluida' AND contract_id IS NOT NULL ORDER BY returned_at DESC, id DESC LIMIT 1").get(assetId) as { contract_id: number } | undefined;
    if (r) transaction(db, () => autoCloseIfReturnedTx(db, req.user!, r.contract_id));
  };
  r.post('/assets/:id/action/:action', (req, res) => {
    const id = parseId(req.params.id);
    const out = assetAction(db, req.user!, id, req.params.action as AssetAction, req.body || {});
    if (req.params.action === 'aprovar_inspecao') closeOriginContract(req, id);
    res.json(out);
  });
  r.post('/assets/:id/inspection', (req, res) => {
    const id = parseId(req.params.id);
    const out = inspectAsset(db, req.user!, id, req.body);
    closeOriginContract(req, id);
    res.json(out);
  });
  r.post('/assets/:id/files', (req, res) => {
    addAssetFile(db, req.user!, parseId(req.params.id), req.body);
    res.status(201).json({ ok: true });
  });
  r.get('/assets/:id/files/:fileId', (req, res) => {
    const f = getAssetFile(db, parseId(req.params.id), parseId(req.params.fileId));
    const buf = Buffer.from(String(f.data).split(',')[1], 'base64');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
    res.send(buf);
  });

  // reservas e disponibilidade
  r.get('/reservations', (req, res) => res.json(listReservations(db, q(req))));
  r.post('/reservations', (req, res) => res.status(201).json(createReservation(db, req.user!, req.body)));
  r.post('/reservations/:id/:action', (req, res) => res.json(reservationAction(db, req.user!, parseId(req.params.id), req.params.action, req.body || {})));
  r.get('/availability', (req, res) => res.json({ rows: availability(db, q(req)) }));

  // fornecedores e locais
  r.get('/suppliers', (req, res) => res.json(listSuppliers(db, q(req))));
  r.post('/suppliers', (req, res) => res.status(201).json(createSupplier(db, req.user!, req.body)));
  r.put('/suppliers/:id', (req, res) => res.json(updateSupplier(db, req.user!, parseId(req.params.id), req.body)));
  r.get('/locations', (_req, res) => res.json({ rows: listLocations(db) }));
  r.post('/locations', (req, res) => res.status(201).json(saveLocation(db, req.user!, null, req.body)));
  r.put('/locations/:id', (req, res) => res.json(saveLocation(db, req.user!, parseId(req.params.id), req.body)));

  // configurações
  r.get('/settings', (_req, res) => res.json(getStockSettings(db)));
  r.put('/settings', (req, res) => res.json(saveStockSettings(db, req.user!, req.body)));

  // relatórios
  r.get('/reports/:kind', (req, res) => {
    const kind = req.params.kind;
    if (!stockCan.viewCosts(req.user!) && ['posicao', 'patrimonio', 'valor_categoria'].includes(kind)) throw forbidden('Relatório com custos não disponível para o seu perfil.');
    const rows = stockReport(db, kind, q(req)) as any[] | null;
    if (!rows) throw badRequest('Relatório inválido.');
    if (req.query.format !== 'csv') return res.json({ rows });
    const defs: Record<string, [string[], (x: any) => (string | number | null)[]]> = {
      posicao: [['Código', 'Item', 'Tipo', 'Categoria', 'Unidade', 'Local', 'Físico', 'Reservado', 'Indisponível', 'Disponível', 'Custo unit. (R$)', 'Custo total (R$)'],
        (x) => [x.code, x.description, ITEM_KIND_LABELS[x.kind as keyof typeof ITEM_KIND_LABELS], x.category, x.unit, x.location, csvNum(x.quantity), csvNum(x.reserved), csvNum(x.unavailable), csvNum(x.available), csvMoney(x.unit_cost), csvMoney(x.total_cost)]],
      abaixo_minimo: [['Código', 'Item', 'Unidade', 'Mínimo', 'Disponível', 'Fornecedor'], (x) => [x.code, x.description, x.unit, csvNum(x.min_qty), csvNum(x.available), x.supplier]],
      patrimonio: [['Patrimônio', 'Nº série', 'Código', 'Item', 'Categoria', 'Aquisição', 'Custo (R$)', 'Estado operacional', 'Locação', 'Local', 'Conservação', 'Baixado em'],
        (x) => [x.asset_tag, x.serial_number, x.code, x.description, x.category, formatDateBR(x.acquisition_date), csvMoney(x.acquisition_cost), OPERATIONAL_LABELS[x.operational_status as keyof typeof OPERATIONAL_LABELS], RENTAL_LABELS[x.rental_status as keyof typeof RENTAL_LABELS], x.location, x.conservation, formatDateTimeBR(x.written_off_at)]],
      valor_categoria: [['Categoria', 'Estoque a custo médio (R$)', 'Patrimônio de locação a custo (R$)', 'Valor comercial estimado (R$)'], (x) => [x.category, csvMoney(Math.round(x.stock_cost)), csvMoney(Math.round(x.rental_cost)), csvMoney(Math.round(x.commercial))]],
      utilizacao: [['Patrimônio', 'Código', 'Item', 'Dias locado', 'Dias no período', 'Utilização (%)'], (x) => [x.asset_tag, x.code, x.description, x.rented_days, x.period_days, csvNum(x.utilization)]],
      divergencias: [['Inventário', 'Aprovado em', 'Código', 'Item', 'Local', 'Sistema', 'Contado', 'Diferença', 'Justificativa'], (x) => [x.inventory, formatDateTimeBR(x.approved_at), x.code, x.description, x.location, csvNum(x.system_qty), csvNum(x.counted_qty), csvNum(x.difference), x.justification]],
    };
    const [head, map] = defs[kind];
    sendCsv(res, `estoque-${kind}.csv`, head, rows.map(map));
  });

  return r;
}
