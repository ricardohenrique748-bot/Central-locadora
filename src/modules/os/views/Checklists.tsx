/**
 * Modelos de checklist de inspeção/testes, por categoria de equipamento (ou geral).
 */

import React, { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { ChecklistTemplate } from '../../../../shared/os/types';
import { osCan } from '../../../../shared/os/rules';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useOs } from '../context';

export const ChecklistsView: React.FC = () => {
  const { user, categories } = useOs();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: ChecklistTemplate[] }>('/os/checklists'), []);
  const [form, setForm] = useState<{ id: number; name: string; category: string; items: { label: string; required: boolean }[]; active: boolean } | null>(null);
  const can = osCan.plans(user);
  return (
    <div>
      <PageHeader title="Checklists de inspeção" subtitle="A OS que exige checklist recebe o modelo da categoria do equipamento (ou o geral). Itens obrigatórios precisam estar aprovados para concluir." actions={can && <Button variant="primary" icon={Plus} onClick={() => setForm({ id: 0, name: '', category: '', items: [{ label: '', required: true }], active: true })}>Novo checklist</Button>} />
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data?.rows.map((t) => (
            <Card key={t.id} title={<span className={cx(!t.active && 'text-slate-400')}>{t.name}</span>} actions={can && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ ...t, category: t.category || '' })}>Editar</Button>}>
              <p className="text-xs text-slate-500 mb-2">{t.category ? `Categoria: ${t.category}` : 'Geral (qualquer equipamento)'}{!t.active && ' • inativo'}</p>
              <ul className="text-sm space-y-1">
                {t.items.map((i, idx) => <li key={idx}>• {i.label} {i.required && <span className="text-xs text-red-600">obrigatório</span>}</li>)}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Editar checklist' : 'Novo checklist'}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancelar</Button>
            <Button variant="primary" onClick={async () => { try { if (form!.id) await api.put(`/os/checklists/${form!.id}`, form); else await api.post('/os/checklists', form); toast('success', 'Checklist salvo.'); setForm(null); reload(); } catch (e) { toast('error', (e as ApiError).message); } }}>
              Salvar
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            <Field label="Nome" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Categoria de equipamento">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Geral</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <div className="space-y-2">
              {form.items.map((it, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input value={it.label} onChange={(e) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder={`Item ${i + 1}`} aria-label={`Item ${i + 1}`} />
                  <Checkbox checked={it.required} onChange={(v) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, required: v } : x)) })} label="Obrigatório" />
                  <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remover item" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })} />
                </div>
              ))}
              <Button size="sm" icon={Plus} onClick={() => setForm({ ...form, items: [...form.items, { label: '', required: true }] })}>Item</Button>
            </div>
            {!!form.id && <Checkbox checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Ativo" />}
          </div>
        )}
      </Modal>
    </div>
  );
};
