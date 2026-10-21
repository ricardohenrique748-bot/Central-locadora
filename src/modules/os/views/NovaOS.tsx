/**
 * Abertura da OS: equipamento do cadastro do Estoque (não cria cadastro aqui), identificação e ocorrência.
 */

import React, { useEffect, useState } from 'react';
import { Search, Save, AlertTriangle, X } from 'lucide-react';
import { ORIGIN_LABELS, Origin, PRIORITY_LABELS, Priority, RISK_LABELS, Risk } from '../../../../shared/os/types';
import { OPERATIONAL_LABELS, RENTAL_LABELS } from '../../../../shared/estoque/types';

/** A locadora não trabalha com manutenção preventiva/programada: esses tipos não são oferecidos na abertura. */
const HIDDEN_TYPES = ['preventiva', 'revisao'];
import { addDaysISO, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, MoneyInput, Notice, PageHeader, Select, Textarea, useDebounced, useToast } from '../../orcamentos/ui';
import { useOs } from '../context';
import { KV } from '../components';

interface AssetRow {
  id: number;
  asset_tag: string;
  serial_number: string | null;
  operational_status: string;
  rental_status: string;
  item_code: string;
  description: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  location_name: string | null;
  contract_ref: string | null;
  customer_name: string | null;
  open_order: string | null;
}

export const NovaOS: React.FC<{ assetId?: number }> = ({ assetId }) => {
  const { user, users, types, settings, navigate } = useOs();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [f, setF] = useState({
    order_type: 'corretiva', origin: 'interna' as Origin, requester: user.name, responsible_user_id: '' as string, priority: 'media' as Priority, due_date: addDaysISO(todayISO(), settings.due_days.media),
    title: '', description: '', symptoms: '', defect_category: '', probable_cause: '', requested_service: '', operational_risk: 'baixo' as Risk, blocks_equipment: false, blocksTouched: false,
    estimated_labor: 0, estimated_other: 0, notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ rows: AssetRow[] }>(`/os/assets${qs({ q: dq })}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [dq]);
  useEffect(() => {
    if (assetId) api.get<{ rows: AssetRow[] }>(`/os/assets?id=${assetId}`).then((r) => setAsset(r.rows[0] || null)).catch(() => undefined);
  }, [assetId]);
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const rule = types.find((t) => t.key === f.order_type);

  const save = async () => {
    if (!asset) return toast('error', 'Selecione o equipamento.');
    setBusy(true);
    setErrors({});
    try {
      const { blocksTouched, ...body } = f;
      const r = await api.post<{ id: number }>('/os/orders', { ...body, asset_id: asset.id, responsible_user_id: f.responsible_user_id || null });
      toast('success', 'OS aberta.');
      navigate({ page: 'detalhe', id: r.id });
    } catch (e) {
      setErrors((e as ApiError).fields || {});
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Nova ordem de serviço" subtitle="O número é gerado ao salvar. Abrir a OS não bloqueia o equipamento, a menos que a manutenção seja impeditiva." onBack={() => navigate({ page: 'painel' })} />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="Equipamento">
            {asset ? (
              <div>
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {asset.asset_tag} — {asset.description}
                    </p>
                    <p className="text-xs text-slate-500">
                      {asset.item_code}
                      {asset.serial_number ? ` • S/N ${asset.serial_number}` : ''}
                      {asset.brand ? ` • ${asset.brand} ${asset.model || ''}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => setAsset(null)}>
                    Trocar
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2">
                  <KV label="Localização">{asset.location_name || '—'}</KV>
                  <KV label="Situação operacional">{OPERATIONAL_LABELS[asset.operational_status as 'operacional']}</KV>
                  <KV label="Locação">{RENTAL_LABELS[asset.rental_status as 'disponivel']}</KV>
                  <KV label="Contrato">{asset.contract_ref ? `${asset.contract_ref} (${asset.customer_name})` : '—'}</KV>
                </div>
                {asset.contract_ref && <Notice className="mt-3">Equipamento locado: a OS fica vinculada ao contrato {asset.contract_ref}. Nada é alterado no contrato nem registrado como devolução.</Notice>}
                {asset.open_order && <Notice kind="warning" className="mt-3">Já existe a OS {asset.open_order} aberta para este equipamento.</Notice>}
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patrimônio, número de série, código ou descrição" className="pl-9" autoFocus aria-label="Pesquisar equipamento" />
                </div>
                <ul className="mt-2 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setAsset(a)} className="w-full text-left px-2 py-2 hover:bg-slate-50 flex justify-between gap-3">
                        <span>
                          <span className="font-semibold">{a.asset_tag}</span> — {a.description}
                          <span className="block text-[11px] text-slate-500">
                            {a.serial_number ? `S/N ${a.serial_number} • ` : ''}
                            {a.location_name || 'sem local'}
                          </span>
                        </span>
                        <span className="text-[11px] text-slate-500 text-right shrink-0">
                          {OPERATIONAL_LABELS[a.operational_status as 'operacional']}
                          {a.contract_ref && <span className="block text-indigo-700">Locado ({a.contract_ref})</span>}
                          {a.open_order && <span className="block text-amber-700">{a.open_order} aberta</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!rows.length && <li className="text-sm text-slate-500 py-4 text-center">Nenhum equipamento encontrado. O equipamento precisa estar cadastrado no Estoque.</li>}
                </ul>
              </>
            )}
          </Card>

          <Card title="Identificação">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Tipo de OS" required error={errors.order_type}>
                <Select value={f.order_type} onChange={(e) => set('order_type', e.target.value)}>
                  {types.filter((t) => !HIDDEN_TYPES.includes(t.key) || t.key === f.order_type).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Origem">
                <Select value={f.origin} onChange={(e) => set('origin', e.target.value)}>
                  {(Object.keys(ORIGIN_LABELS) as Origin[]).filter((o) => o !== 'preventiva').map((o) => (
                    <option key={o} value={o}>
                      {ORIGIN_LABELS[o]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Solicitante">
                <Input value={f.requester} onChange={(e) => set('requester', e.target.value)} />
              </Field>
              <Field label="Prioridade">
                <Select value={f.priority} onChange={(e) => (set('priority', e.target.value), set('due_date', addDaysISO(todayISO(), settings.due_days[e.target.value as Priority])))}>
                  {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prazo previsto" error={errors.due_date}>
                <Input type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
              </Field>
              <Field label="Responsável pelo atendimento" error={errors.responsible_user_id}>
                <Select value={f.responsible_user_id} onChange={(e) => set('responsible_user_id', e.target.value)}>
                  <option value="">A definir</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="Ocorrência">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Defeito ou serviço solicitado" required className="md:col-span-2" error={errors.title}>
                <Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: motor não liga, vazamento de óleo" />
              </Field>
              <Field label="Categoria do defeito">
                <Input value={f.defect_category} onChange={(e) => set('defect_category', e.target.value)} placeholder="Ex.: elétrica, motor, estrutura" />
              </Field>
              <Field label="Risco operacional">
                <Select value={f.operational_risk} onChange={(e) => (set('operational_risk', e.target.value), !f.blocksTouched && set('blocks_equipment', e.target.value === 'alto'))}>
                  {(Object.keys(RISK_LABELS) as Risk[]).map((r) => (
                    <option key={r} value={r}>
                      {RISK_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Descrição detalhada" className="md:col-span-2">
                <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <Field label="Sintomas identificados">
                <Textarea rows={2} value={f.symptoms} onChange={(e) => set('symptoms', e.target.value)} />
              </Field>
              <Field label="Causa provável">
                <Textarea rows={2} value={f.probable_cause} onChange={(e) => set('probable_cause', e.target.value)} />
              </Field>
              <Field label="Serviço solicitado" className="md:col-span-2">
                <Textarea rows={2} value={f.requested_service} onChange={(e) => set('requested_service', e.target.value)} />
              </Field>
              <div className="md:col-span-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
                <Checkbox checked={f.blocks_equipment} onChange={(v) => (set('blocks_equipment', v), set('blocksTouched', true))} label={<b>Manutenção impeditiva: bloquear o equipamento para novas locações</b>} />
                <p className="text-xs text-slate-500 mt-1 ml-6 flex gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> O equipamento só volta a ser locável depois da conclusão da OS e da inspeção aprovada. Reservas futuras não são canceladas automaticamente.
                </p>
              </div>
            </div>
          </Card>
        </div>
        <aside className="space-y-4 xl:sticky xl:top-[120px]">
          <Card title="Custos previstos (opcional)">
            <div className="space-y-3">
              <Field label="Mão de obra prevista">
                <MoneyInput value={f.estimated_labor} onChange={(v) => set('estimated_labor', v ?? 0)} />
              </Field>
              <Field label="Outros custos previstos">
                <MoneyInput value={f.estimated_other} onChange={(v) => set('estimated_other', v ?? 0)} />
              </Field>
              <p className="text-xs text-slate-500">Peças e terceiros entram na previsão quando forem lançados na OS. Previsto não é despesa realizada.</p>
            </div>
          </Card>
          {rule && (
            <Notice>
              <b>{rule.label}:</b> {rule.requires_diagnosis ? 'exige diagnóstico' : 'diagnóstico opcional'}; {rule.requires_checklist ? 'exige checklist de inspeção para concluir.' : 'checklist opcional.'}
            </Notice>
          )}
          <Field label="Observações">
            <Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => navigate({ page: 'painel' })}>Cancelar</Button>
            <Button variant="primary" icon={Save} loading={busy} disabled={!asset} onClick={save}>
              Abrir OS
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
};
