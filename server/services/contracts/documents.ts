/**
 * Documentos do contrato: contrato, aditivos, comprovantes de entrega/devolução e anexos.
 *
 * - Documento gerado guarda uma FOTOGRAFIA dos dados (snapshot) e o PDF é sempre refeito a partir dela:
 *   a versão emitida não muda se o contrato mudar depois.
 * - Gerado ≠ enviado ≠ assinado. "Assinado" exige evidência registrada (método, data, quem assinou).
 *   Não há assinatura eletrônica integrada: os campos signature_provider/external_signature_id ficam
 *   prontos para uma integração futura e nada simula uma assinatura digital.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { formatBRL } from '../../../shared/orcamentos/money';
import { formatDateBR, todayISO } from '../../../shared/orcamentos/dates';
import { formatDocument } from '../../../shared/orcamentos/validators';
import { BILLING_FREQUENCY_LABELS, ContractDocument, DocumentType, PERIOD_NOUN, RESPONSIBILITY_LABELS } from '../../../shared/contratos/types';
import { contractCan } from '../../../shared/contratos/rules';
import { getSettings } from '../../settings';
import { NOW_SQL, SALE_TEMPLATE, contractEvent, getContractSettings, loadItems, loadRaw, rowToContract, text } from './core';
import { scheduleFor } from './billing';
import { listOperations } from './operations';
import { renderContractDocumentPdf } from './pdf';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d} de ${MONTHS[Number(m) - 1]} de ${y}`;
};

/** Preenche o modelo configurável com os dados do contrato. As marcas de tabela/assinatura ficam para o PDF desenhar. */
export function fillTemplate(tpl: string, c: any, companyName: string, schedule: { due_date: string }[] = []) {
  const r = c.responsibilities || {};
  const cs = c.customer_snapshot;
  const map: Record<string, string> = {
    empresa: companyName,
    cliente: cs.name,
    documento_cliente: cs.document ? `${cs.person_type === 'PJ' ? 'CNPJ' : 'CPF'} ${formatDocument(cs.document)}` : 'documento não informado',
    numero_documento_cliente: cs.document ? formatDocument(cs.document) : '',
    endereco_cliente: cs.address || 'endereço não informado',
    ie_cliente: cs.state_registration ? `, e Inscrição Estadual ${cs.state_registration}` : '',
    local_obra: c.delivery_address || cs.address || 'não informado',
    primeiro_vencimento: formatDateBR(schedule[0]?.due_date || c.start_date),
    data_extenso: longDate(todayISO()),
    numero: c.contract_number,
    inicio: formatDateBR(c.start_date),
    termino: c.end_date ? formatDateBR(c.end_date) : 'prazo indeterminado',
    valor_periodo: formatBRL(c.contract_type === 'venda' ? c.sale_total : c.period_amount),
    periodo: c.contract_type === 'venda' ? 'contrato' : PERIOD_NOUN[c.billing_frequency as keyof typeof PERIOD_NOUN] + (c.billing_frequency === 'personalizado' ? ` de ${c.custom_period_days} dias` : ''),
    periodicidade: BILLING_FREQUENCY_LABELS[c.billing_frequency as keyof typeof BILLING_FREQUENCY_LABELS],
    condicoes_pagamento: c.payment_terms || 'conforme cronograma',
    multa: String(c.late_fee_percent ?? 0).replace('.', ','),
    juros: String(c.interest_month_percent ?? 0).replace('.', ','),
    caucao: c.deposit_amount ? formatBRL(c.deposit_amount) : 'não há',
    reajuste: c.adjustment_index ? `Reajuste pelo índice ${c.adjustment_index}${c.adjustment_period_months ? ` a cada ${c.adjustment_period_months} meses` : ''}.` : 'Sem reajuste previsto.',
    resp_transporte: RESPONSIBILITY_LABELS[r.transporte as keyof typeof RESPONSIBILITY_LABELS] || 'a combinar',
    resp_combustivel: RESPONSIBILITY_LABELS[r.combustivel as keyof typeof RESPONSIBILITY_LABELS] || 'a combinar',
    resp_manutencao: RESPONSIBILITY_LABELS[r.manutencao as keyof typeof RESPONSIBILITY_LABELS] || 'a combinar',
    resp_avarias: RESPONSIBILITY_LABELS[r.avarias as keyof typeof RESPONSIBILITY_LABELS] || 'a combinar',
    condicoes_especiais: c.special_conditions || 'nenhuma',
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => map[k] ?? m);
}

function snapshotFor(db: DB, contractId: number, type: DocumentType, ref: { operation_id?: number; amendment_id?: number; item_ids?: number[] }) {
  const raw = loadRaw(db, contractId);
  const c = rowToContract({ ...raw, quotation_number: null }, loadItems(db, contractId));
  const company = getSettings(db).company;
  const base: any = { type, contract: c, company, generated_at: new Date().toISOString() };
  if (type === 'contrato' || type === 'aditivo') {
    const cs = getContractSettings(db);
    if (cs.lessor_signature) base.lessor_signature = { image: cs.lessor_signature, name: cs.lessor_signatory || null };
  }
  if (type === 'contrato') {
    base.schedule = scheduleFor(db, raw);
    const rental = c.contract_type === 'locacao';
    // locação usa o modelo da empresa (cláusulas numeradas + tabelas); documentos antigos sem "layout" seguem o leiaute anterior
    if (rental) base.layout = 'locacao_bens_moveis';
    base.clauses = fillTemplate(rental ? getContractSettings(db).contract_template : SALE_TEMPLATE, c, company.name, base.schedule);
  } else if (type === 'aditivo') {
    base.amendment = db.prepare('SELECT a.*, u.name AS created_by_name FROM contract_amendments a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = ?').get(ref.amendment_id!);
    if (ref.item_ids?.length) base.added_items = c.items.filter((i) => ref.item_ids!.includes(i.id));
  } else {
    base.operation = listOperations(db, contractId).find((o) => o.id === ref.operation_id);
  }
  return base;
}

/** Emite um documento gerado pelo sistema (DENTRO de transação). Retorna o id. */
export function issueDocumentTx(db: DB, user: AuthUser | null, contractId: number, type: DocumentType, title: string, ref: { operation_id?: number; amendment_id?: number; item_ids?: number[] } = {}): number {
  const version = ((db.prepare('SELECT MAX(version) v FROM contract_documents WHERE contract_id = ? AND document_type = ?').get(contractId, type) as { v: number | null }).v || 0) + 1;
  if (type === 'contrato') db.prepare(`UPDATE contract_documents SET status = 'substituido' WHERE contract_id = ? AND document_type = 'contrato' AND status IN ('gerado','enviado')`).run(contractId);
  const snap = snapshotFor(db, contractId, type, ref);
  const row = db
    .prepare(
      `INSERT INTO contract_documents (contract_id, document_type, title, version, status, snapshot_data, file_name, mime_type, operation_id, amendment_id, issued_by)
       VALUES (?, ?, ?, ?, 'gerado', ?, ?, 'application/pdf', ?, ?, ?) RETURNING id`
    )
    .get(contractId, type, title, version, JSON.stringify(snap), `${snap.contract.contract_number}-${type}-v${version}.pdf`, ref.operation_id ?? null, ref.amendment_id ?? null, user?.id ?? null) as { id: number };
  return row.id;
}

export function listDocuments(db: DB, contractId: number): ContractDocument[] {
  return (
    db
      .prepare(
        `SELECT d.id, d.document_type, d.title, d.version, d.status, d.file_name, d.mime_type, d.file_data IS NOT NULL AS has_file, d.snapshot_data IS NOT NULL AS generated,
           d.operation_id, d.amendment_id, d.issued_at, u.name AS issued_by_name, d.sent_at, d.sent_channel, d.signed_at, d.signed_by_names, d.signature_method, d.signature_evidence
         FROM contract_documents d LEFT JOIN users u ON u.id = d.issued_by WHERE d.contract_id = ? ORDER BY d.issued_at DESC, d.id DESC`
      )
      .all(contractId) as any[]
  ).map((d) => ({ ...d, has_file: !!d.has_file, generated: !!d.generated }));
}

/**
 * Exclui um documento avulso. Anexos e versões não assinadas: admin/gestor. Comprovante de entrega ou
 * devolução: só o admin (não é reemitido; a operação continua em Movimentações). Assinado: nunca.
 */
export function deleteDocument(db: DB, user: AuthUser, contractId: number, docId: number) {
  return transaction(db, () => {
    const d = db.prepare('SELECT id, document_type, title, version, status FROM contract_documents WHERE id = ? AND contract_id = ?').get(docId, contractId) as any;
    if (!d) throw notFound('Documento não encontrado.');
    if (!contractCan.cancel(user)) throw forbidden('Só administrador ou gestor exclui documentos do contrato.');
    if (d.status === 'assinado') throw new HttpError(422, 'Documento assinado é a prova da assinatura registrada e não é excluído.');
    const receipt = d.document_type === 'comprovante_entrega' || d.document_type === 'comprovante_devolucao';
    if (receipt && user.role !== 'admin') throw forbidden('Comprovantes de entrega/devolução só são excluídos pelo administrador.');
    // a marca libera a trava do banco só para este documento e só dentro desta transação
    db.prepare('INSERT INTO contract_document_purges (document_id) VALUES (?)').run(docId);
    db.prepare('DELETE FROM contract_documents WHERE id = ?').run(docId);
    db.prepare('DELETE FROM contract_document_purges WHERE document_id = ?').run(docId);
    contractEvent(db, contractId, 'documento', `Documento excluído: ${d.title} (v${d.version}, ${d.status}).`, user);
    audit(db, 'contract_document', docId, 'delete', user.id, { contract_id: contractId, title: d.title, version: d.version, status: d.status, document_type: d.document_type });
    return { deleted: d.title as string };
  });
}

export function markDocumentSent(db: DB, user: AuthUser, contractId: number, docId: number, raw: any) {
  if (!contractCan.documents(user)) throw forbidden();
  const channel = text(raw?.channel, 80);
  if (!channel) throw badRequest('Informe como o documento foi enviado (e-mail, WhatsApp, em mãos...).', { channel: 'Obrigatório.' });
  transaction(db, () => {
    const d = db.prepare('SELECT * FROM contract_documents WHERE id = ? AND contract_id = ?').get(docId, contractId) as any;
    if (!d) throw notFound('Documento não encontrado.');
    if (d.status !== 'gerado') throw new HttpError(422, 'Somente documentos gerados (não enviados) podem ser marcados como enviados.');
    db.prepare(`UPDATE contract_documents SET status = 'enviado', sent_at = ${NOW_SQL}, sent_channel = ? WHERE id = ?`).run(channel, docId);
    contractEvent(db, contractId, 'documento', `${d.title} v${d.version} marcado como enviado (${channel}).`, user);
  });
}

const MAX_FILE = 2_000_000; // base64 (~1,4 MB)

function decodeFile(raw: any) {
  const content = typeof raw?.content === 'string' ? raw.content : '';
  const m = content.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) throw badRequest('Arquivo inválido.');
  if (m[2].length > MAX_FILE) throw badRequest('Arquivo muito grande (máx. ~1,4 MB).');
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(m[1])) throw badRequest('Envie PDF ou imagem (PNG, JPG, WEBP).');
  return { mime: m[1], data: m[2], name: text(raw?.file_name, 120) || 'arquivo' };
}

/** Anexo (ex.: fotos, via assinada digitalizada). Insere dentro de transação quando `tx`. */
export function addAttachmentTx(db: DB, user: AuthUser, contractId: number, raw: any, title?: string): number {
  const f = decodeFile(raw);
  const version = ((db.prepare("SELECT MAX(version) v FROM contract_documents WHERE contract_id = ? AND document_type = 'anexo'").get(contractId) as { v: number | null }).v || 0) + 1;
  const row = db
    .prepare(
      `INSERT INTO contract_documents (contract_id, document_type, title, version, status, file_name, mime_type, file_data, operation_id, issued_by)
       VALUES (?, 'anexo', ?, ?, 'gerado', ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(contractId, title || text(raw?.title, 120) || f.name, version, f.name, f.mime, f.data, raw?.operation_id ? Number(raw.operation_id) : null, user.id) as { id: number };
  contractEvent(db, contractId, 'documento', `Anexo incluído: ${title || text(raw?.title, 120) || f.name}.`, user);
  return row.id;
}

export function addAttachment(db: DB, user: AuthUser, contractId: number, raw: any) {
  if (!contractCan.documents(user) && !contractCan.operate(user)) throw forbidden();
  return transaction(db, () => {
    loadRaw(db, contractId);
    return { id: addAttachmentTx(db, user, contractId, raw) };
  });
}

export function generateContractDocument(db: DB, user: AuthUser, contractId: number) {
  if (!contractCan.documents(user)) throw forbidden();
  return transaction(db, () => {
    const c = loadRaw(db, contractId);
    if (['rascunho', 'aguardando_aprovacao', 'cancelado'].includes(c.status)) throw new HttpError(422, 'O documento do contrato é gerado após a aprovação interna.');
    const id = issueDocumentTx(db, user, contractId, 'contrato', `Contrato ${c.contract_number}`);
    const version = (db.prepare('SELECT version FROM contract_documents WHERE id = ?').get(id) as { version: number }).version;
    if (c.status === 'aprovado' && !c.signed_at) {
      db.prepare(`UPDATE contracts SET status = 'aguardando_assinatura', updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(user.id, contractId);
      contractEvent(db, contractId, 'status', `Documento do contrato v${version} gerado; aguardando assinatura.`, user, 'aprovado', 'aguardando_assinatura');
    } else contractEvent(db, contractId, 'documento', `Documento do contrato v${version} gerado.`, user);
    return { id };
  });
}

export async function documentFile(db: DB, user: AuthUser, contractId: number, docId: number): Promise<{ buffer: Buffer; mime: string; name: string }> {
  if (!contractCan.view(user)) throw forbidden();
  const d = db.prepare('SELECT * FROM contract_documents WHERE id = ? AND contract_id = ?').get(docId, contractId) as any;
  if (!d) throw notFound('Documento não encontrado.');
  if (d.file_data) return { buffer: Buffer.from(d.file_data, 'base64'), mime: d.mime_type, name: d.file_name };
  const snap = JSON.parse(d.snapshot_data);
  const showValues = contractCan.viewValues(user);
  return { buffer: await renderContractDocumentPdf(snap, { version: d.version, status: d.status, showValues }), mime: 'application/pdf', name: d.file_name };
}
