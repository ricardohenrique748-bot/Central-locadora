/**
 * Programação de entrega, retirada ou devolução a partir de um contrato.
 * Nada é movimentado no estoque aqui: só a programação (com validação de saldo e disponibilidade).
 */

import React, { useEffect, useState } from 'react';
import { Search, Save, X } from 'lucide-react';
import { OP_TYPE_LABELS, OpType, PICKUP_REASON_LABELS, PickupReason, TRANSPORT_LABELS, TransportType } from '../../../../shared/logistica/types';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, MoneyInput, Notice, PageHeader, Select, Textarea, cx, useDebounced, useToast } from '../../orcamentos/ui';
import { fmtQty } from '../../estoque/components';
import { toLocalInput, useLog } from '../context';
import { Th } from '../components';

interface PlanItem {
  id: number;
  item_code: string;
  description: string;
  unit: string;
  tracking: 'quantidade' | 'individual';
  asset_id: number | null;
  asset_tag: string | null;
  serial_number: string | null;
  modality: string;
  quantity: number;
  delivered_qty: number;
  returned_qty: number;
  sold_delivered_qty: number;
  planned_elsewhere: number;
  available_to_plan: number;
}

export const NovaOperacao: React.FC<{ type: OpType; contractId?: number }> = ({ type: initialType, contractId }) => {
  const { users, drivers, vehicles, suppliers, locations, navigate } = useLog();
  const toast = useToast();
  const [type, setType] = useState<OpType>(initialType);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [contracts, setContracts] = useState<{ id: number; contract_number: string; customer_name: string; status: string; start_date: string; end_date: string | null }[]>([]);
  const [plan, setPlan] = useState<{ contract: any; items: PlanItem[] } | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [f, setF] = useState({ scheduled_at: toLocalInput(null, 24), address: '', contact_name: '', contact_phone: '', access_instructions: '', special_equipment: '', transport_type: (initialType === 'devolucao' ? 'cliente' : 'proprio') as TransportType, driver_id: '', vehicle_id: '', carrier_supplier_id: '', responsible_user_id: '', reason: 'fim_contrato' as PickupReason, return_location_id: '', transport_cost_estimated: null as number | null, notes: '', draft: false });
  const [busy, setBusy] = useState(false);
  const isReturn = type !== 'entrega';

  useEffect(() => {
    api.get<{ rows: any[] }>(`/logistics/contracts${qs({ q: dq, type: isReturn ? 'retorno' : 'entrega' })}`).then((r) => setContracts(r.rows)).catch(() => setContracts([]));
  }, [dq, isReturn]);
  const loadPlan = (id: number) =>
    api.get<{ contract: any; items: PlanItem[] }>(`/logistics/contracts/${id}/planning?type=${type}`).then((p) => {
      setPlan(p);
      setQty(Object.fromEntries(p.items.map((i) => [i.id, i.available_to_plan > 0 ? String(i.available_to_plan) : '0'])));
      setF((x) => ({ ...x, address: x.address || (type === 'entrega' ? p.contract.delivery_address || p.contract.customer.address : p.contract.customer.address) || '', contact_name: x.contact_name || p.contract.customer.contact_name || '', contact_phone: x.contact_phone || p.contract.customer.phone || '' }));
    }).catch((e) => toast('error', e.message));
  useEffect(() => {
    if (contractId) loadPlan(contractId);
  }, [contractId]);
  useEffect(() => {
    if (plan) loadPlan(plan.contract.id);
  }, [type]);

  const save = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>('/logistics/operations', {
        ...f, op_type: type, contract_id: plan.contract.id, scheduled_at: new Date(f.scheduled_at).toISOString(), driver_id: f.driver_id || null, vehicle_id: f.vehicle_id || null,
        carrier_supplier_id: f.carrier_supplier_id || null, responsible_user_id: f.responsible_user_id || null, return_location_id: f.return_location_id || null,
        items: plan.items.map((i) => ({ contract_item_id: i.id, quantity: Number(String(qty[i.id] || 0).replace(',', '.')) })).filter((i) => i.quantity > 0),
      });
      toast('success', 'Operação programada. Nenhuma movimentação de estoque foi feita.');
      navigate({ page: 'detalhe', id: r.id });
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={`Nova ${type === 'entrega' ? 'entrega' : type === 'retirada' ? 'retirada' : 'devolução'}`} subtitle="A programação reserva o saldo do contrato para esta operação; a saída/entrada física só acontece na confirmação." onBack={() => navigate({ page: 'painel' })} />
      <div className="flex gap-2 mb-4">
        {(['entrega', 'retirada', 'devolucao'] as OpType[]).map((t) => (
          <button key={t} onClick={() => (setType(t), setF((x) => ({ ...x, transport_type: t === 'devolucao' ? 'cliente' : x.transport_type === 'cliente' && t !== 'entrega' ? 'proprio' : x.transport_type })))} className={cx('px-3 py-1.5 rounded-lg text-sm font-semibold border', type === t ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-slate-600 border-slate-200')}>
            {OP_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="Contrato">
            {plan ? (
              <div className="flex justify-between gap-3">
                <div>
                  <p className="font-semibold">{plan.contract.contract_number} — {plan.contract.customer.name}</p>
                  <p className="text-xs text-slate-500">Vigência {formatDateBR(plan.contract.start_date)} a {plan.contract.end_date ? formatDateBR(plan.contract.end_date) : 'indeterminado'} • {plan.contract.status}</p>
                </div>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setPlan(null)}>Trocar</Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número do contrato ou cliente" className="pl-9" autoFocus aria-label="Pesquisar contrato" />
                </div>
                <ul className="mt-2 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {contracts.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => loadPlan(c.id)} className="w-full text-left px-2 py-2 hover:bg-slate-50">
                        <b>{c.contract_number}</b> — {c.customer_name} <span className="text-xs text-slate-500">({c.status})</span>
                      </button>
                    </li>
                  ))}
                  {!contracts.length && <li className="text-sm text-slate-500 py-4 text-center">Nenhum contrato apto. {isReturn ? 'Retiradas exigem contrato de locação com equipamentos entregues.' : 'Entregas exigem contrato agendado ou ativo.'}</li>}
                </ul>
              </>
            )}
          </Card>
          {plan && (
            <Card title="Equipamentos" bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Item</Th>
                      <Th>Patrimônio / série</Th>
                      <Th right>Contratado</Th>
                      <Th right>{isReturn ? 'Com o cliente' : 'Entregue'}</Th>
                      <Th right>Em outra operação</Th>
                      <Th right>Disponível p/ programar</Th>
                      <Th right>{isReturn ? 'Retirar' : 'Entregar'}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.map((i) => (
                      <tr key={i.id} className={cx('border-t border-slate-100', i.available_to_plan <= 0 && 'text-slate-400')}>
                        <td className="px-4 py-2"><span className="font-mono text-xs mr-1">{i.item_code}</span>{i.description}{i.modality === 'venda' && <span className="text-[11px] ml-1">(venda)</span>}</td>
                        <td className="px-4 py-2">{[i.asset_tag, i.serial_number].filter(Boolean).join(' / ') || (i.tracking === 'individual' ? <span className="text-amber-700 text-xs">a definir no contrato</span> : '—')}</td>
                        <td className="px-4 py-2 text-right">{fmtQty(i.quantity, i.unit)}</td>
                        <td className="px-4 py-2 text-right">{fmtQty(isReturn ? i.delivered_qty : i.modality === 'venda' ? i.sold_delivered_qty : i.delivered_qty + i.returned_qty)}</td>
                        <td className="px-4 py-2 text-right">{i.planned_elsewhere ? fmtQty(i.planned_elsewhere) : '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold">{fmtQty(i.available_to_plan)}</td>
                        <td className="px-4 py-2 text-right w-32">
                          {i.available_to_plan <= 0 ? '—' : i.tracking === 'individual' ? (
                            <Checkbox checked={qty[i.id] === '1'} onChange={(v) => setQty({ ...qty, [i.id]: v ? '1' : '0' })} label="Incluir" />
                          ) : (
                            <Input type="number" min={0} max={i.available_to_plan} step="any" value={qty[i.id] || ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Quantidade ${i.item_code}`} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 px-4 py-3 border-t border-slate-100">A disponibilidade (manutenção, inspeção, OS e outras reservas) é validada ao salvar e novamente na confirmação.</p>
            </Card>
          )}
          {plan && (
            <Card title="Programação e logística">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {isReturn && (
                  <Field label="Motivo" required>
                    <Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value as PickupReason })}>
                      {(Object.keys(PICKUP_REASON_LABELS) as PickupReason[]).map((r) => <option key={r} value={r}>{PICKUP_REASON_LABELS[r]}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Data e horário programados" required><Input type="datetime-local" value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} /></Field>
                <Field label="Transporte">
                  <Select value={f.transport_type} onChange={(e) => setF({ ...f, transport_type: e.target.value as TransportType })}>
                    {(Object.keys(TRANSPORT_LABELS) as TransportType[]).map((t) => <option key={t} value={t}>{TRANSPORT_LABELS[t]}</option>)}
                  </Select>
                </Field>
                <Field label={type === 'entrega' ? 'Endereço da entrega' : 'Endereço da retirada'} className="sm:col-span-2 lg:col-span-3" hint="Específico desta operação — o cadastro do cliente não é alterado.">
                  <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
                </Field>
                <Field label="Contato no local"><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
                <Field label="Telefone do contato"><Input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
                <Field label="Responsável interno">
                  <Select value={f.responsible_user_id} onChange={(e) => setF({ ...f, responsible_user_id: e.target.value })}>
                    <option value="">Eu</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </Field>
                {f.transport_type === 'proprio' && (
                  <>
                    <Field label="Motorista">
                      <Select value={f.driver_id} onChange={(e) => setF({ ...f, driver_id: e.target.value })}>
                        <option value="">A definir</option>
                        {drivers.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Veículo">
                      <Select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}>
                        <option value="">A definir</option>
                        {vehicles.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.description}</option>)}
                      </Select>
                    </Field>
                  </>
                )}
                {f.transport_type === 'terceiro' && (
                  <Field label="Transportadora (fornecedor)">
                    <Select value={f.carrier_supplier_id} onChange={(e) => setF({ ...f, carrier_supplier_id: e.target.value })}>
                      <option value="">Selecione</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                )}
                {isReturn && (
                  <Field label="Local de retorno no estoque">
                    <Select value={f.return_location_id} onChange={(e) => setF({ ...f, return_location_id: e.target.value })}>
                      <option value="">Local de saída</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Instruções de acesso" className="sm:col-span-2"><Input value={f.access_instructions} onChange={(e) => setF({ ...f, access_instructions: e.target.value })} placeholder="Portaria, horário, restrições" /></Field>
                <Field label="Equipamento especial de carga/descarga"><Input value={f.special_equipment} onChange={(e) => setF({ ...f, special_equipment: e.target.value })} placeholder="Ex.: munck, rampa" /></Field>
                <Field label="Observações operacionais" className="sm:col-span-2 lg:col-span-3"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
              </div>
            </Card>
          )}
        </div>
        <aside className="space-y-4 xl:sticky xl:top-[120px]">
          {plan && (
            <Card title="Custo de transporte (estimado)">
              <MoneyInput value={f.transport_cost_estimated} allowEmpty onChange={(v) => setF({ ...f, transport_cost_estimated: v })} />
              <p className="text-xs text-slate-500 mt-2">Estimativa não é despesa. O custo realizado é registrado na operação e, se for de transportadora, pode ser enviado ao Financeiro.</p>
            </Card>
          )}
          <Notice>{isReturn ? 'Os equipamentos recebidos entram no estoque retidos para inspeção — não ficam disponíveis automaticamente.' : 'A saída do estoque só acontece quando a entrega for confirmada com o nome de quem recebeu.'}</Notice>
          <Checkbox checked={f.draft} onChange={(v) => setF({ ...f, draft: v })} label="Salvar como rascunho" />
          <div className="flex gap-2 justify-end">
            <Button onClick={() => navigate({ page: 'painel' })}>Cancelar</Button>
            <Button variant="primary" icon={Save} loading={busy} disabled={!plan} onClick={save}>{f.draft ? 'Salvar rascunho' : 'Programar'}</Button>
          </div>
        </aside>
      </div>
      {plan && plan.items.some((i) => i.tracking === 'individual' && !i.asset_tag) && <Notice kind="warning" className="mt-4">Há equipamentos individuais sem patrimônio definido no contrato: defina-os no contrato antes de programar a entrega.</Notice>}
    </div>
  );
};
