/**
 * Configurações das OS: alçada de custo, prazos por prioridade, antecedência das preventivas,
 * categoria financeira das despesas e tipos de OS adicionais.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { OsSettings, PRIORITY_LABELS, Priority } from '../../../../shared/os/types';
import { osCan } from '../../../../shared/os/rules';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, MoneyInput, PageHeader, Select, useToast } from '../../orcamentos/ui';
import { useOs } from '../context';

export const OsConfigView: React.FC = () => {
  const { settings, user, reload } = useOs();
  const toast = useToast();
  const [f, setF] = useState<OsSettings>(settings);
  const [cats, setCats] = useState<{ id: number; name: string; category_type: string; active: boolean }[]>([]);
  const admin = osCan.configure(user);
  useEffect(() => setF(settings), [settings]);
  useEffect(() => {
    api.get<{ rows: any[] }>('/finance/categories').then((r) => setCats(r.rows.filter((c) => c.category_type === 'despesa' && c.active))).catch(() => setCats([]));
  }, []);
  return (
    <div>
      <PageHeader title="Configurações de manutenção" subtitle={admin ? 'Regras aplicadas pelo servidor.' : 'Visualização — alterações somente pelo administrador.'} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <Card title="Regras">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Alçada: custo previsto acima disto exige aprovação antes da execução (0 = desligado)" className="sm:col-span-2">
              <MoneyInput value={f.approval_limit} disabled={!admin} onChange={(v) => setF({ ...f, approval_limit: v ?? 0 })} />
            </Field>
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
              <Field key={p} label={`Prazo padrão — ${PRIORITY_LABELS[p]} (dias)`}>
                <Input type="number" min={0} disabled={!admin} value={f.due_days[p]} onChange={(e) => setF({ ...f, due_days: { ...f.due_days, [p]: Number(e.target.value) } })} />
              </Field>
            ))}
            <Field label="Categoria financeira das despesas de terceiros">
              <Select value={f.maintenance_category_id ?? ''} disabled={!admin} onChange={(e) => setF({ ...f, maintenance_category_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Selecione</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
        </Card>
        <Card title="Tipos de OS adicionais" actions={admin && <Button size="sm" icon={Plus} onClick={() => setF({ ...f, custom_types: [...f.custom_types, { key: '', label: '', requires_diagnosis: false, requires_checklist: false }] })}>Tipo</Button>}>
          <p className="text-xs text-slate-500 mb-3">Os tipos padrão (corretiva, preventiva, inspeção, revisão, avaria, instalação, desmontagem, garantia, terceirizado) não mudam.</p>
          {f.custom_types.length === 0 && <p className="text-sm text-slate-500">Nenhum tipo adicional.</p>}
          <div className="space-y-2">
            {f.custom_types.map((t, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-center">
                <Input value={t.label} disabled={!admin} onChange={(e) => setF({ ...f, custom_types: f.custom_types.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="Nome do tipo" className="flex-1 min-w-[160px]" aria-label="Nome do tipo" />
                <Checkbox checked={t.requires_diagnosis} disabled={!admin} onChange={(v) => setF({ ...f, custom_types: f.custom_types.map((x, j) => (j === i ? { ...x, requires_diagnosis: v } : x)) })} label="Exige diagnóstico" />
                <Checkbox checked={t.requires_checklist} disabled={!admin} onChange={(v) => setF({ ...f, custom_types: f.custom_types.map((x, j) => (j === i ? { ...x, requires_checklist: v } : x)) })} label="Exige checklist" />
                {admin && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remover tipo" onClick={() => setF({ ...f, custom_types: f.custom_types.filter((_, j) => j !== i) })} />}
              </div>
            ))}
          </div>
        </Card>
      </div>
      {admin && (
        <div className="flex justify-end mt-5">
          <Button variant="primary" icon={Save} onClick={async () => { try { await api.put('/os/settings', f); toast('success', 'Configurações salvas.'); reload(); } catch (e) { toast('error', (e as ApiError).message); } }}>
            Salvar
          </Button>
        </div>
      )}
    </div>
  );
};
