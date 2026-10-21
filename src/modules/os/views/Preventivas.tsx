/**
 * Planos de manutenção preventiva por equipamento ou categoria, programação e leituras de medidor.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Pencil, RefreshCw, Gauge } from 'lucide-react';
import { ChecklistTemplate, MaintenancePlan } from '../../../../shared/os/types';
import { osCan } from '../../../../shared/os/rules';
import { formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useOs } from '../context';
import { Th } from '../components';

const empty = () => ({ id: 0, name: '', description: '', scope: 'equipamento', asset_id: '' as string | number, asset_label: '', category: '', interval_days: '' as string | number, interval_hours: '' as string | number, interval_cycles: '' as string | number, first_due_date: todayISO(), checklist_template_id: '' as string | number, responsible_user_id: '' as string | number, estimated_minutes: '' as string | number, lead_days: 7, active: true, notes: '' });

export const PreventivasView: React.FC = () => {
  const { user, users, categories, settings, navigate } = useOs();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: MaintenancePlan[] }>('/os/plans'), []);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [form, setForm] = useState<ReturnType<typeof empty> | null>(null);
  const [busy, setBusy] = useState(false);
  const [assetQ, setAssetQ] = useState('');
  const dq = useDebounced(assetQ, 250);
  const [assets, setAssets] = useState<{ id: number; asset_tag: string; description: string }[]>([]);
  const [meter, setMeter] = useState<{ asset_id: number; asset_tag: string; kind: 'horas' | 'ciclos'; reading: string } | null>(null);
  useEffect(() => {
    api.get<{ rows: ChecklistTemplate[] }>('/os/checklists').then((r) => setTemplates(r.rows.filter((t) => t.active))).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!form || form.scope !== 'equipamento' || !dq) return setAssets([]);
    api.get<{ rows: any[] }>(`/os/assets${qs({ q: dq })}`).then((r) => setAssets(r.rows)).catch(() => setAssets([]));
  }, [dq, form?.scope]);
  const can = osCan.plans(user);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const body = { ...form, asset_id: form.scope === 'equipamento' ? form.asset_id : null, category: form.scope === 'categoria' ? form.category : null };
      if (form.id) await api.put(`/os/plans/${form.id}`, body);
      else await api.post('/os/plans', body);
      toast('success', 'Plano salvo.');
      setForm(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Manutenção preventiva"
        subtitle={`As OS preventivas são geradas automaticamente (uma vez por dia) com ${settings.preventive_lead_days} dias de antecedência padrão, sem duplicar o mesmo vencimento.`}
        actions={
          can && (
            <>
              <Button icon={RefreshCw} onClick={async () => { try { const r = await api.post<{ created: number }>('/os/plans/generate'); toast('success', `${r.created} OS preventiva(s) gerada(s).`); reload(); } catch (e) { toast('error', (e as ApiError).message); } }}>
                Gerar agora
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => (setForm({ ...empty(), lead_days: settings.preventive_lead_days }), setAssetQ(''))}>
                Novo plano
              </Button>
            </>
          )
        }
      />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data?.rows.length ? (
        <Card><EmptyState title="Nenhum plano preventivo" text="Crie planos por equipamento ou por categoria (ex.: todas as betoneiras a cada 90 dias)." /></Card>
      ) : (
        <div className="space-y-4">
          {data.rows.map((p) => (
            <Card
              key={p.id}
              title={<span className={cx(!p.active && 'text-slate-400')}>{p.name} {!p.active && '(inativo)'}</span>}
              actions={can && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ ...empty(), ...p, scope: p.asset_id ? 'equipamento' : 'categoria', asset_id: p.asset_id ?? '', asset_label: p.asset_tag || '', category: p.category || '', interval_days: p.interval_days ?? '', interval_hours: p.interval_hours ?? '', interval_cycles: p.interval_cycles ?? '', checklist_template_id: p.checklist_template_id ?? '', responsible_user_id: p.responsible_user_id ?? '', estimated_minutes: p.estimated_minutes ?? '', description: p.description || '', notes: p.notes || '', first_due_date: '' })}>Editar</Button>}
              bodyClassName="p-0"
            >
              <p className="text-xs text-slate-500 px-4 pt-3">
                {p.asset_id ? `Equipamento ${p.asset_tag}` : `Categoria: ${p.category}`} • a cada {[p.interval_days && `${p.interval_days} dias`, p.interval_hours && `${p.interval_hours} h de uso`, p.interval_cycles && `${p.interval_cycles} ciclos`].filter(Boolean).join(' ou ')}
                {p.responsible_name ? ` • responsável ${p.responsible_name}` : ''} • antecedência {p.lead_days} dias
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px] mt-2">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Equipamento</Th>
                      <Th>Última</Th>
                      <Th>Próxima (data)</Th>
                      <Th>Próxima (medidor)</Th>
                      <Th>OS aberta</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.schedules.map((s) => (
                      <tr key={s.asset_id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-semibold">{s.asset_tag}</td>
                        <td className="px-4 py-2">{formatDateBR(s.last_done_at)}</td>
                        <td className={cx('px-4 py-2', s.next_due_date && s.next_due_date < todayISO() && 'text-red-700 font-semibold')}>{formatDateBR(s.next_due_date)}</td>
                        <td className="px-4 py-2">{s.next_due_meter !== null ? `${s.next_due_meter} (atual ${s.current_meter ?? '—'})` : p.interval_hours || p.interval_cycles ? 'Sem leitura registrada' : '—'}</td>
                        <td className="px-4 py-2">{s.open_order || '—'}</td>
                        <td className="px-4 py-2 text-right">
                          {(p.interval_hours || p.interval_cycles) && (
                            <Button size="sm" variant="ghost" icon={Gauge} onClick={() => setMeter({ asset_id: s.asset_id, asset_tag: s.asset_tag, kind: p.interval_hours ? 'horas' : 'ciclos', reading: '' })}>
                              Leitura
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!p.schedules.length && <tr><td colSpan={6} className="px-4 py-3 text-slate-500 text-sm">Nenhum equipamento ativo neste plano.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Editar plano' : 'Novo plano preventivo'} size="lg" footer={<><Button onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome do plano" required className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Aplicar a">
              <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                <option value="equipamento">Um equipamento</option>
                <option value="categoria">Todos os equipamentos de uma categoria</option>
              </Select>
            </Field>
            {form.scope === 'equipamento' ? (
              <Field label="Equipamento" required>
                {form.asset_id ? (
                  <div className="flex gap-2 items-center"><b className="text-sm">{form.asset_label}</b><Button size="sm" variant="ghost" onClick={() => setForm({ ...form, asset_id: '', asset_label: '' })}>Trocar</Button></div>
                ) : (
                  <div className="relative">
                    <Input value={assetQ} onChange={(e) => setAssetQ(e.target.value)} placeholder="Patrimônio ou descrição" />
                    {assets.length > 0 && (
                      <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                        {assets.map((a) => <button key={a.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => (setForm({ ...form, asset_id: a.id, asset_label: a.asset_tag }), setAssets([]))}><b>{a.asset_tag}</b> — {a.description}</button>)}
                      </div>
                    )}
                  </div>
                )}
              </Field>
            ) : (
              <Field label="Categoria" required>
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">Selecione</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            )}
            <Field label="A cada (dias)"><Input type="number" min={1} value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: e.target.value })} /></Field>
            <Field label="A cada (horas de uso)" hint="Só para equipamentos com horímetro"><Input type="number" min={0} step="any" value={form.interval_hours} onChange={(e) => setForm({ ...form, interval_hours: e.target.value })} /></Field>
            <Field label="A cada (ciclos/utilizações)" hint="Só quando houver contador"><Input type="number" min={0} step="any" value={form.interval_cycles} onChange={(e) => setForm({ ...form, interval_cycles: e.target.value })} /></Field>
            {!form.id && <Field label="Primeira data prevista"><Input type="date" value={form.first_due_date} onChange={(e) => setForm({ ...form, first_due_date: e.target.value })} /></Field>}
            <Field label="Checklist padrão">
              <Select value={form.checklist_template_id} onChange={(e) => setForm({ ...form, checklist_template_id: e.target.value })}>
                <option value="">Da categoria / geral</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Responsável">
              <Select value={form.responsible_user_id} onChange={(e) => setForm({ ...form, responsible_user_id: e.target.value })}>
                <option value="">A definir</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Tempo estimado (min)"><Input type="number" min={0} value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} /></Field>
            <Field label="Antecedência para gerar a OS (dias)"><Input type="number" min={0} max={90} value={form.lead_days} onChange={(e) => setForm({ ...form, lead_days: Number(e.target.value) })} /></Field>
            <Field label="Descrição" className="sm:col-span-2"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Observações / serviço padrão" className="sm:col-span-2"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            {!!form.id && <Checkbox checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Plano ativo" />}
          </div>
        )}
      </Modal>

      <Modal open={!!meter} onClose={() => setMeter(null)} title={`Leitura do medidor — ${meter?.asset_tag}`} size="sm" footer={<><Button onClick={() => setMeter(null)}>Voltar</Button><Button variant="primary" onClick={async () => { try { await api.post(`/os/equipment/${meter!.asset_id}/meter`, { kind: meter!.kind, reading: Number(meter!.reading.replace(',', '.')) }); toast('success', 'Leitura registrada.'); setMeter(null); reload(); } catch (e) { toast('error', (e as ApiError).message); } }}>Registrar</Button></>}>
        {meter && <Field label={meter.kind === 'horas' ? 'Horímetro (horas)' : 'Contador (ciclos)'}><Input type="number" min={0} step="any" value={meter.reading} onChange={(e) => setMeter({ ...meter, reading: e.target.value })} /></Field>}
      </Modal>
      <p className="text-xs text-slate-500 mt-4">Concluir uma OS preventiva atualiza a próxima data/medidor pela regra do plano. <button className="underline" onClick={() => navigate({ page: 'checklists' })}>Gerenciar checklists</button></p>
    </div>
  );
};
