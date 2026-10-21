/**
 * Janelas de operação do contrato: entrega, devolução, assinatura, renovação, reajuste,
 * cobrança extraordinária e justificativas. Cada envio leva uma chave única (sem duplicidade).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ContractDetail, DELIVERY_CHECKLIST, PERIOD_NOUN, RETURN_CLASS_LABELS, ReturnClassification, SIGNATURE_METHOD_LABELS, SignatureMethod } from '../../../../shared/contratos/types';
import { lineTotal } from '../../../../shared/contratos/rules';
import { INSPECTION_CHECKLIST, StockItemRow } from '../../../../shared/estoque/types';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Checkbox, Field, Input, Modal, MoneyInput, Notice, Select, Textarea, cx, useToast } from '../../orcamentos/ui';
import { ItemSearch, fmtQty } from '../../estoque/components';
import { newKey } from '../context';
import { AssetPicker, priceFor, pricesOf } from './Form';

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function useLocations() {
  const [rows, setRows] = useState<{ id: number; code: string; name: string; active: boolean }[]>([]);
  useEffect(() => {
    api.get<{ rows: any[] }>('/stock/locations').then((r) => setRows(r.rows.filter((l) => l.active))).catch(() => setRows([]));
  }, []);
  return rows;
}

async function readFile(file: File): Promise<{ file_name: string; content: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ file_name: file.name, content: String(r.result) });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

interface Base {
  c: ContractDetail;
  open: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}

function useSubmit(onDone: (m: string) => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      onDone(msg);
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields || {});
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, run };
}

// ------------------------------------------------ justificativa / confirmação

export const ReasonModal: React.FC<Base & { title: string; action: string; required: boolean; label?: string; danger?: boolean; text?: React.ReactNode; extra?: Record<string, unknown> }> = ({
  c, open, onClose, onDone, title, action, required, label = 'Justificativa', danger, text, extra,
}) => {
  const [reason, setReason] = useState('');
  const { busy, errors, run } = useSubmit(onDone);
  useEffect(() => setReason(''), [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={required && !reason.trim()} onClick={() => run(() => api.post(`/contracts/${c.id}/action/${action}`, { reason, row_version: c.row_version, ...extra }), `${title}: concluído.`)}>
            Confirmar
          </Button>
        </>
      }
    >
      {text && <div className="text-sm text-slate-600 mb-3">{text}</div>}
      <Field label={label} required={required} error={errors.reason}>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
    </Modal>
  );
};

// ------------------------------------------------ assinatura (somente com evidência)

export const SignatureModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const [f, setF] = useState({ signature_method: 'presencial' as SignatureMethod, signed_at: todayISO(), signed_by_names: '', signature_evidence: '', signature_provider: '', external_signature_id: '' });
  const [file, setFile] = useState<{ file_name: string; content: string } | null>(null);
  const { busy, errors, run } = useSubmit(onDone);
  const doc = c.documents.find((d) => d.document_type === 'contrato' && (d.status === 'gerado' || d.status === 'enviado'));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar assinatura"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.post(`/contracts/${c.id}/action/registrar_assinatura`, { ...f, file, row_version: c.row_version }), 'Assinatura registrada.')}>
            Registrar
          </Button>
        </>
      }
    >
      <Notice className="mb-3">
        Registra a assinatura do documento <b>{doc ? `${doc.title} v${doc.version}` : '—'}</b>. O sistema não tem assinatura eletrônica integrada: informe a evidência real (via física arquivada, via digitalizada ou protocolo da plataforma usada).
      </Notice>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Como foi assinado" required error={errors.signature_method}>
          <Select value={f.signature_method} onChange={(e) => setF({ ...f, signature_method: e.target.value as SignatureMethod })}>
            {(Object.keys(SIGNATURE_METHOD_LABELS) as SignatureMethod[]).map((m) => (
              <option key={m} value={m}>
                {SIGNATURE_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data da assinatura" required error={errors.signed_at}>
          <Input type="date" max={todayISO()} value={f.signed_at} onChange={(e) => setF({ ...f, signed_at: e.target.value })} />
        </Field>
        <Field label="Quem assinou (partes)" required className="sm:col-span-2" error={errors.signed_by_names}>
          <Input value={f.signed_by_names} onChange={(e) => setF({ ...f, signed_by_names: e.target.value })} placeholder="Ex.: João Silva (cliente) e Maria Souza (locadora)" />
        </Field>
        <Field label="Evidência" required className="sm:col-span-2" error={errors.signature_evidence}>
          <Textarea rows={2} value={f.signature_evidence} onChange={(e) => setF({ ...f, signature_evidence: e.target.value })} placeholder="Ex.: via original arquivada na pasta de contratos 2026 / protocolo nº..." />
        </Field>
        {f.signature_method === 'plataforma_externa' && (
          <>
            <Field label="Plataforma">
              <Input value={f.signature_provider} onChange={(e) => setF({ ...f, signature_provider: e.target.value })} />
            </Field>
            <Field label="Identificador / protocolo">
              <Input value={f.external_signature_id} onChange={(e) => setF({ ...f, external_signature_id: e.target.value })} />
            </Field>
          </>
        )}
        {f.signature_method === 'digitalizado' && (
          <Field label="Via assinada (PDF ou imagem, até ~1,4 MB)" required className="sm:col-span-2" error={errors.file}>
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={async (e) => setFile(e.target.files?.[0] ? await readFile(e.target.files[0]) : null)} className="text-sm" />
          </Field>
        )}
      </div>
    </Modal>
  );
};

// ------------------------------------------------ entrega

export const DeliveryModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const locations = useLocations();
  const pending = useMemo(
    () => c.items.map((i) => ({ i, left: i.modality === 'venda' ? i.quantity - i.sold_delivered_qty : i.quantity - i.delivered_qty - i.returned_qty })).filter((x) => x.left > 1e-9),
    [c]
  );
  const [qty, setQty] = useState<Record<number, string>>({});
  const [f, setF] = useState({ performed_at: nowLocal(), counterpart_name: '', counterpart_document: '', accessories: '', notes: '', location_id: '' });
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [key, setKey] = useState(newKey());
  const { busy, run } = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(pending.map((p) => [p.i.id, String(p.left)])));
    setKey(newKey());
  }, [open]);
  const lines = pending.map((p) => ({ contract_item_id: p.i.id, quantity: Number(qty[p.i.id] || 0) })).filter((l) => l.quantity > 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar entrega"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} disabled={!lines.length} onClick={() => run(() => api.post(`/contracts/${c.id}/deliveries`, { ...f, location_id: f.location_id || null, checklist, lines, idempotency_key: key }), 'Entrega registrada e estoque atualizado.')}>
            Confirmar entrega
          </Button>
        </>
      }
    >
      <Notice className="mb-3">A entrega dá a saída física no estoque (a reserva sozinha não dá). Disponibilidade e estado dos equipamentos são conferidos novamente agora.</Notice>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 text-left">
              <th className="py-1.5">Item</th>
              <th className="py-1.5">Pendente</th>
              <th className="py-1.5 w-32">Entregar</th>
            </tr>
          </thead>
          <tbody>
            {pending.map(({ i, left }) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="py-2 pr-2">
                  <span className="font-mono text-xs text-slate-500 mr-1">{i.item_code}</span>
                  {i.description}
                  {i.asset_tag && <span className="ml-1 text-xs font-semibold">({i.asset_tag})</span>}
                  {i.modality === 'venda' && <span className="ml-1 text-[11px] text-slate-500">venda</span>}
                </td>
                <td className="py-2">{fmtQty(left, i.unit)}</td>
                <td className="py-2">
                  {i.tracking === 'individual' ? (
                    <Checkbox checked={qty[i.id] === '1'} onChange={(v) => setQty({ ...qty, [i.id]: v ? '1' : '0' })} label="Entregar" />
                  ) : (
                    <Input type="number" min={0} max={left} step="any" value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Quantidade de ${i.item_code}`} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Field label="Data e hora da entrega" required>
          <Input type="datetime-local" value={f.performed_at} max={nowLocal()} onChange={(e) => setF({ ...f, performed_at: e.target.value })} />
        </Field>
        <Field label="Local de saída" hint="Opcional: usa o local da reserva / padrão do item">
          <Select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
            <option value="">Padrão</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Recebido por">
          <Input value={f.counterpart_name} onChange={(e) => setF({ ...f, counterpart_name: e.target.value })} placeholder="Nome de quem recebeu" />
        </Field>
        <Field label="Documento de quem recebeu">
          <Input value={f.counterpart_document} onChange={(e) => setF({ ...f, counterpart_document: e.target.value })} placeholder="RG/CPF" />
        </Field>
        <Field label="Acessórios entregues" className="sm:col-span-2">
          <Input value={f.accessories} onChange={(e) => setF({ ...f, accessories: e.target.value })} />
        </Field>
        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {DELIVERY_CHECKLIST.map((k) => (
            <Checkbox key={k.key} checked={!!checklist[k.key]} onChange={(v) => setChecklist({ ...checklist, [k.key]: v })} label={k.label} />
          ))}
        </div>
        <Field label="Observações / estado dos equipamentos" className="sm:col-span-2">
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <p className="text-xs text-slate-500 mt-2">O comprovante de entrega é gerado automaticamente na aba Documentos para impressão e assinatura do recebedor. Fotos podem ser anexadas lá.</p>
    </Modal>
  );
};

// ------------------------------------------------ devolução

interface RetLine {
  returned: boolean;
  classification: ReturnClassification;
  condition: string;
  inspection: Record<string, boolean>;
  returned_qty: string;
  damaged_qty: string;
  maintenance_qty: string;
  missing_qty: string;
  notes: string;
}

export const ReturnModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const locations = useLocations();
  const withClient = c.items.filter((i) => i.modality === 'locacao' && i.delivered_qty > 0);
  const [lines, setLines] = useState<Record<number, RetLine>>({});
  const [f, setF] = useState({ performed_at: nowLocal(), counterpart_name: '', notes: '', location_id: '' });
  const [key, setKey] = useState(newKey());
  const { busy, run } = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    setLines(
      Object.fromEntries(
        withClient.map((i) => [i.id, { returned: false, classification: 'aguardando_inspecao', condition: '', inspection: {}, returned_qty: '', damaged_qty: '', maintenance_qty: '', missing_qty: '', notes: '' } as RetLine])
      )
    );
    setKey(newKey());
  }, [open]);
  const upd = (id: number, p: Partial<RetLine>) => setLines((ls) => ({ ...ls, [id]: { ...ls[id], ...p } }));
  const payload = withClient.map((i) => ({ contract_item_id: i.id, ...lines[i.id] }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar devolução"
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.post(`/contracts/${c.id}/returns`, { ...f, location_id: f.location_id || null, lines: payload, idempotency_key: key }), 'Devolução registrada.')}>
            Confirmar devolução
          </Button>
        </>
      }
    >
      <Notice className="mb-3">Retornar fisicamente não libera o equipamento: ele fica aguardando inspeção, salvo se a conferência for feita agora (checklist completo).</Notice>
      <div className="space-y-3">
        {withClient.map((i) => {
          const l = lines[i.id];
          if (!l) return null;
          return (
            <div key={i.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-semibold">
                <span className="font-mono text-xs text-slate-500 mr-1">{i.item_code}</span>
                {i.description} {i.asset_tag && <span className="text-xs">({i.asset_tag})</span>}
                <span className="ml-2 text-xs font-normal text-slate-500">com o cliente: {fmtQty(i.delivered_qty, i.unit)}</span>
              </p>
              {i.tracking === 'individual' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 items-end">
                  <Checkbox checked={l.returned} onChange={(v) => upd(i.id, { returned: v })} label="Devolvido" />
                  {l.returned && (
                    <>
                      <Field label="Situação">
                        <Select value={l.classification} onChange={(e) => upd(i.id, { classification: e.target.value as ReturnClassification })}>
                          {(Object.keys(RETURN_CLASS_LABELS) as ReturnClassification[]).map((k) => (
                            <option key={k} value={k}>
                              {RETURN_CLASS_LABELS[k]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Estado de conservação">
                        <Select value={l.condition} onChange={(e) => upd(i.id, { condition: e.target.value })}>
                          <option value="">Não informado</option>
                          <option value="bom">Bom</option>
                          <option value="regular">Regular</option>
                          <option value="ruim">Ruim</option>
                        </Select>
                      </Field>
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {(
                    [
                      ['returned_qty', 'Devolvidas em ordem'],
                      ['damaged_qty', 'Com avaria'],
                      ['maintenance_qty', 'Para manutenção'],
                      ['missing_qty', 'Não devolvidas'],
                    ] as const
                  ).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <Input type="number" min={0} step="any" value={l[k]} onChange={(e) => upd(i.id, { [k]: e.target.value } as Partial<RetLine>)} />
                    </Field>
                  ))}
                </div>
              )}
              {l.returned && i.tracking === 'individual' && l.classification === 'disponivel' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-2 p-2 rounded bg-slate-50">
                  {INSPECTION_CHECKLIST.map((k) => (
                    <Checkbox key={k.key} checked={!!l.inspection[k.key]} onChange={(v) => upd(i.id, { inspection: { ...l.inspection, [k.key]: v } })} label={k.label} />
                  ))}
                </div>
              )}
              {(i.tracking === 'quantidade' || l.returned) && (
                <Input
                  className="mt-2"
                  value={l.notes}
                  onChange={(e) => upd(i.id, { notes: e.target.value })}
                  placeholder={l.classification === 'avaria' || l.classification === 'manutencao' || Number(l.damaged_qty) || Number(l.maintenance_qty) ? 'Descreva as avarias / motivo (obrigatório)' : 'Observações'}
                  aria-label="Observações da devolução"
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <Field label="Data e hora" required>
          <Input type="datetime-local" value={f.performed_at} max={nowLocal()} onChange={(e) => setF({ ...f, performed_at: e.target.value })} />
        </Field>
        <Field label="Local de retorno" hint="Opcional: usa o local de saída">
          <Select value={f.location_id} onChange={(e) => setF({ ...f, location_id: e.target.value })}>
            <option value="">Local de saída</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} — {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Devolvido por">
          <Input value={f.counterpart_name} onChange={(e) => setF({ ...f, counterpart_name: e.target.value })} />
        </Field>
        <Field label="Observações gerais" className="sm:col-span-3">
          <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
};

// ------------------------------------------------ renovação / prorrogação

export const ExtendModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const [f, setF] = useState({ amendment_type: 'prorrogacao', new_end: c.end_date ? addDaysISO(c.end_date, 30) : '', indefinite: false, reason: '' });
  const { busy, errors, run } = useSubmit(onDone);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Renovar / prorrogar"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.post(`/contracts/${c.id}/action/prorrogar`, { ...f, row_version: c.row_version }), 'Vigência atualizada (aditivo registrado).')}>
            Registrar aditivo
          </Button>
        </>
      }
    >
      <Notice className="mb-3">A agenda dos equipamentos é verificada para o período adicional antes de prorrogar. Se já houver cobranças geradas, as dos novos períodos são lançadas automaticamente.</Notice>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={f.amendment_type} onChange={(e) => setF({ ...f, amendment_type: e.target.value })}>
            <option value="prorrogacao">Prorrogação</option>
            <option value="renovacao">Renovação</option>
          </Select>
        </Field>
        <Field label={`Nova data de término (atual: ${c.end_date ? formatDateBR(c.end_date) : 'indeterminado'})`} error={errors.new_end}>
          <Input type="date" disabled={f.indefinite} value={f.new_end} onChange={(e) => setF({ ...f, new_end: e.target.value })} />
          {c.end_date && (
            <div className="mt-1.5">
              <Checkbox checked={f.indefinite} onChange={(v) => setF({ ...f, indefinite: v })} label="Passar a prazo indeterminado" />
            </div>
          )}
        </Field>
        <Field label="Justificativa" required className="sm:col-span-2" error={errors.reason}>
          <Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
};

// ------------------------------------------------ reajuste

export const RepriceModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const [mode, setMode] = useState<'percent' | 'itens'>('percent');
  const [percent, setPercent] = useState('');
  const [prices, setPrices] = useState<Record<number, number>>({});
  const [f, setF] = useState({ effective_date: todayISO(), reason: '' });
  const { busy, errors, run } = useSubmit(onDone);
  const rentalItems = c.items.filter((i) => i.modality === 'locacao');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reajustar valores"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.post(`/contracts/${c.id}/action/reajustar`, { ...f, row_version: c.row_version, ...(mode === 'percent' ? { percent } : { prices }) }), 'Reajuste registrado (aditivo).')}>
            Registrar reajuste
          </Button>
        </>
      }
    >
      <Notice className="mb-3">O histórico fica no aditivo. Só mudam as cobranças a partir da data informada que ainda não tiveram recebimento; períodos passados e cobranças pagas não são alterados.</Notice>
      <div className="flex gap-4 mb-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'percent'} onChange={() => setMode('percent')} /> Percentual
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'itens'} onChange={() => setMode('itens')} /> Valor por item
        </label>
      </div>
      {mode === 'percent' ? (
        <Field label={`Percentual${c.adjustment_index ? ` (índice do contrato: ${c.adjustment_index})` : ''}`} error={errors.percent}>
          <Input type="number" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="Ex.: 4,5" />
        </Field>
      ) : (
        <div className="space-y-2">
          {rentalItems.map((i) => (
            <div key={i.id} className="grid grid-cols-[1fr_160px] gap-2 items-center text-sm">
              <span className="truncate">
                {i.item_code} {i.asset_tag ? `(${i.asset_tag})` : ''} — atual {formatBRL(i.unit_price)}
              </span>
              <MoneyInput value={prices[i.id] ?? i.unit_price} onChange={(v) => setPrices({ ...prices, [i.id]: v ?? 0 })} />
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <Field label="Vigência do novo valor" required error={errors.effective_date}>
          <Input type="date" min={todayISO()} value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} />
        </Field>
        <Field label="Justificativa" required className="sm:col-span-2" error={errors.reason}>
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
};

// ------------------------------------------------ inclusão de itens (aditivo)

interface AddLine {
  key: string;
  item: StockItemRow;
  asset_id: number | null;
  asset_tag: string | null;
  quantity: string;
  modality: 'locacao' | 'venda';
  unit_price: number;
  discount_amount: number;
  conditions: string;
}

export const AddItemsModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const toast = useToast();
  const [lines, setLines] = useState<AddLine[]>([]);
  const [f, setF] = useState({ effective_date: todayISO() > c.start_date ? todayISO() : c.start_date, reason: '' });
  const { busy, errors, run } = useSubmit(onDone);
  const noun = PERIOD_NOUN[c.billing_frequency];
  const resEnd = c.end_date || addDaysISO(f.effective_date, 365);
  const taken = [...c.items.filter((i) => i.asset_id && i.quantity - i.returned_qty > 1e-9).map((i) => i.asset_id!), ...lines.filter((l) => l.asset_id).map((l) => l.asset_id!)];
  const qty = (l: AddLine) => (l.item.tracking === 'individual' ? 1 : Number(l.quantity) || 0);
  const added = lines.filter((l) => l.modality === 'locacao').reduce((a, l) => a + lineTotal({ quantity: qty(l), unit_price: l.unit_price, discount_amount: l.discount_amount }), 0);
  const sold = lines.filter((l) => l.modality === 'venda').reduce((a, l) => a + lineTotal({ quantity: qty(l), unit_price: l.unit_price, discount_amount: l.discount_amount }), 0);

  const addItem = (i: StockItemRow) => {
    const modality: 'locacao' | 'venda' = i.rental_enabled ? 'locacao' : 'venda';
    if (modality === 'venda' && (!i.sale_enabled || i.tracking === 'individual')) return toast('error', `${i.internal_code} não está habilitado para locação.`);
    setLines((ls) => [...ls, { key: newKey(), item: i, asset_id: null, asset_tag: null, quantity: '1', modality, unit_price: priceFor(pricesOf(i), modality, c.billing_frequency), discount_amount: 0, conditions: '' }]);
  };
  const upd = (key: string, patch: Partial<AddLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const submit = () =>
    run(
      () =>
        api.post(`/contracts/${c.id}/action/incluir_itens`, {
          ...f,
          row_version: c.row_version,
          items: lines.map((l) => ({ item_id: l.item.id, asset_id: l.asset_id, quantity: qty(l), modality: l.modality, unit_price: l.unit_price, discount_amount: l.discount_amount, conditions: l.conditions })),
        }),
      'Itens incluídos (aditivo gerado na aba Documentos).'
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Incluir itens no contrato"
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} disabled={!lines.length || !f.reason.trim()} onClick={submit}>
            Registrar aditivo
          </Button>
        </>
      }
    >
      <Notice className="mb-3">
        Os itens novos são reservados no Estoque a partir da data informada até o término do contrato. O valor por período passa a incluí-los: cobranças futuras ainda sem recebimento são ajustadas e o período em curso recebe uma cobrança
        complementar proporcional aos dias restantes.
      </Notice>
      <ItemSearch onPick={addItem} placeholder="Adicionar produto ou equipamento (código, nome ou código de barras)" />
      {errors.items && <p className="text-xs text-red-600 mt-1">{errors.items}</p>}
      {lines.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">Nenhum item. Pesquise acima para incluir.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {lines.map((l, idx) => {
            const err = errors[`items.${idx}`];
            return (
              <div key={l.key} className={cx('rounded-lg border p-3', err ? 'border-red-300 bg-red-50/40' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800 min-w-0">
                    <span className="font-mono text-xs text-slate-500 mr-1.5">{l.item.internal_code}</span>
                    {l.item.description}
                  </p>
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remover item" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                </div>
                {err && <p className="text-xs text-red-700">{err}</p>}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2 items-end">
                  {l.item.tracking === 'individual' ? (
                    <Field label="Patrimônio / série" className="col-span-2">
                      <AssetPicker line={{ item_id: l.item.id, asset_id: l.asset_id, asset_tag: l.asset_tag }} from={f.effective_date} to={resEnd} taken={taken.filter((a) => a !== l.asset_id)} onPick={(aid, tag) => upd(l.key, { asset_id: aid, asset_tag: tag })} />
                    </Field>
                  ) : (
                    <Field label={`Quantidade (${l.item.unit})`}>
                      <Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })} />
                    </Field>
                  )}
                  {l.item.tracking !== 'individual' && l.item.sale_enabled && l.item.rental_enabled && (
                    <Field label="Modalidade">
                      <Select value={l.modality} onChange={(e) => {
                        const m = e.target.value as 'locacao' | 'venda';
                        upd(l.key, { modality: m, unit_price: priceFor(pricesOf(l.item), m, c.billing_frequency) });
                      }}>
                        <option value="locacao">Locação</option>
                        <option value="venda">Venda</option>
                      </Select>
                    </Field>
                  )}
                  <Field label={l.modality === 'venda' ? 'Valor unitário' : `Valor por ${noun}`}>
                    <MoneyInput value={l.unit_price} onChange={(v) => upd(l.key, { unit_price: v ?? 0 })} />
                  </Field>
                  <Field label="Desconto (R$)">
                    <MoneyInput value={l.discount_amount} onChange={(v) => upd(l.key, { discount_amount: v ?? 0 })} />
                  </Field>
                  <div className="text-right pb-2">
                    <p className="text-[11px] text-slate-500">Total{l.modality === 'locacao' ? ` / ${noun}` : ''}</p>
                    <p className="font-bold tabular-nums">{formatBRL(lineTotal({ quantity: qty(l), unit_price: l.unit_price, discount_amount: l.discount_amount }))}</p>
                  </div>
                </div>
                <Input className="mt-2" value={l.conditions} onChange={(e) => upd(l.key, { conditions: e.target.value })} placeholder="Condições específicas do item (aparecem no aditivo)" aria-label="Condições do item" />
              </div>
            );
          })}
          <div className="text-sm text-right text-slate-700">
            Valor por {noun}: {formatBRL(c.period_amount)} → <strong>{formatBRL(c.period_amount + added)}</strong>
            {sold > 0 && <span className="ml-3">Venda: {formatBRL(sold)} (cobrança única)</span>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        <Field label="Válido a partir de" required error={errors.effective_date}>
          <Input type="date" min={todayISO() > c.start_date ? todayISO() : c.start_date} max={c.end_date ? addDaysISO(c.end_date, -1) : undefined} value={f.effective_date} onChange={(e) => setF({ ...f, effective_date: e.target.value })} />
        </Field>
        <Field label="Justificativa" required className="sm:col-span-2" error={errors.reason}>
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex.: cliente solicitou mais 2 andaimes para a obra" />
        </Field>
      </div>
    </Modal>
  );
};

// ------------------------------------------------ cobranças

export const ExtraChargeModal: React.FC<Base> = ({ c, open, onClose, onDone }) => {
  const [f, setF] = useState({ description: '', amount: 0, due_date: addDaysISO(todayISO(), 5), reason: '' });
  const [key, setKey] = useState(newKey());
  const { busy, errors, run } = useSubmit(onDone);
  useEffect(() => {
    setKey(newKey());
    if (open) setF({ description: '', amount: 0, due_date: addDaysISO(todayISO(), 5), reason: '' });
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lançar cobrança"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} onClick={() => run(() => api.post(`/contracts/${c.id}/charges/extra`, { ...f, idempotency_key: key }), 'Cobrança lançada no Financeiro.')}>
            Lançar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Descrição" required error={errors.description}>
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: indenização de peça extraviada" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor" required error={errors.amount}>
            <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0 })} />
          </Field>
          <Field label="Vencimento" required error={errors.due_date}>
            <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Justificativa" required error={errors.reason}>
          <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
};

export const ChargeEditModal: React.FC<Base & { charge: { id: number; description: string; amount: number } | null; mode: 'adjust' | 'cancel' }> = ({ c, open, onClose, onDone, charge, mode }) => {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const { busy, errors, run } = useSubmit(onDone);
  useEffect(() => (setAmount(charge?.amount || 0), setReason('')), [charge, open]);
  if (!charge) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'adjust' ? 'Ajustar cobrança' : 'Cancelar cobrança'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button
            variant={mode === 'cancel' ? 'danger' : 'primary'}
            loading={busy}
            disabled={!reason.trim()}
            onClick={() => run(() => api.post(`/contracts/${c.id}/charges/${charge.id}/${mode}`, { amount, reason }), mode === 'adjust' ? 'Cobrança ajustada.' : 'Cobrança cancelada.')}
          >
            Confirmar
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 mb-3">
        {charge.description} — {formatBRL(charge.amount)}. Somente cobranças sem recebimento podem ser {mode === 'adjust' ? 'ajustadas' : 'canceladas'}; o histórico é mantido.
      </p>
      {mode === 'adjust' && (
        <Field label="Novo valor (crédito ou acréscimo autorizado)" error={errors.amount}>
          <MoneyInput value={amount} onChange={(v) => setAmount(v ?? 0)} />
        </Field>
      )}
      <Field label="Justificativa" required className="mt-3" error={errors.reason}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
};

export const SentModal: React.FC<Base & { docId: number | null }> = ({ c, open, onClose, onDone, docId }) => {
  const [channel, setChannel] = useState('');
  const { busy, run } = useSubmit(onDone);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Marcar documento como enviado"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant="primary" loading={busy} disabled={!channel.trim()} onClick={() => run(() => api.post(`/contracts/${c.id}/documents/${docId}/sent`, { channel }), 'Envio registrado.')}>
            Confirmar
          </Button>
        </>
      }
    >
      <Field label="Como foi enviado" required>
        <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="E-mail, WhatsApp, entregue em mãos..." />
      </Field>
      <p className={cx('text-xs text-slate-500 mt-2')}>Enviado não significa assinado: a assinatura é registrada à parte, com evidência.</p>
    </Modal>
  );
};

export { readFile };
