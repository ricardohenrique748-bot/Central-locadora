/**
 * Configurações do estoque: categorias/subcategorias, unidades, locais e motivos de saída (administrador).
 */

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Pencil, MapPin } from 'lucide-react';
import { LOCATION_TYPE_LABELS, LocationType, StockLocation, StockSettings } from '../../../../shared/estoque/types';
import { stockCan } from '../../../../shared/estoque/rules';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, Modal, Notice, PageHeader, Select, cx, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { Th } from '../components';

export const ConfigEstoque: React.FC = () => {
  const { user, settings, locations, reload } = useStock();
  const toast = useToast();
  const admin = stockCan.configure(user);
  const [form, setForm] = useState<StockSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'locais' | 'categorias' | 'unidades' | 'motivos'>('locais');
  const [loc, setLoc] = useState<Partial<StockLocation> | null>(null);
  useEffect(() => setForm(settings), [settings]);

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api.put('/stock/settings', form);
      toast('success', 'Configurações salvas.');
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };
  const saveLoc = async () => {
    if (!loc) return;
    setSaving(true);
    try {
      if (loc.id) await api.put(`/stock/locations/${loc.id}`, loc);
      else await api.post('/stock/locations', loc);
      toast('success', 'Local salvo.');
      setLoc(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const listEditor = (values: string[], onChange: (v: string[]) => void, placeholder: string) => (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input value={v} disabled={!admin} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
          {admin && <Button variant="ghost" icon={Trash2} onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label="Remover" />}
        </div>
      ))}
      {admin && (
        <Button size="sm" icon={Plus} onClick={() => onChange([...values, ''])}>
          {placeholder}
        </Button>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="Configurações do Estoque" subtitle={admin ? 'Parâmetros usados nos cadastros e movimentações.' : 'Visualização — alterações somente pelo administrador.'} />
      <div className="flex gap-1 overflow-x-auto mb-4 pb-1">
        {(
          [
            ['locais', 'Locais de armazenamento'],
            ['categorias', 'Categorias'],
            ['unidades', 'Unidades de medida'],
            ['motivos', 'Motivos de saída'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap', tab === k ? 'bg-[#1e3a5f] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'locais' && (
        <Card
          title="Depósitos, filiais e locais"
          bodyClassName="p-0"
          actions={
            admin && (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setLoc({ code: '', name: '', location_type: 'deposito', active: true })}>
                Novo local
              </Button>
            )
          }
        >
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Código</Th>
                <Th>Nome</Th>
                <Th>Tipo</Th>
                <Th className="hidden md:table-cell">Responsável</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold">{l.code}</td>
                  <td className="px-4 py-2.5">
                    <p className="font-semibold">{l.name}</p>
                    {l.address && <p className="text-[11px] text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{l.address}</p>}
                  </td>
                  <td className="px-4 py-2.5">{LOCATION_TYPE_LABELS[l.location_type]}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell">{l.responsible || '—'}</td>
                  <td className="px-4 py-2.5">{l.active ? <span className="text-emerald-700 text-xs font-semibold">Ativo</span> : <span className="text-slate-500 text-xs">Inativo</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    {admin && (
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setLoc(l)}>
                        Editar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'categorias' && (
        <Card title="Categorias e subcategorias">
          <div className="space-y-4">
            {form.categories.map((c, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="flex gap-2 mb-2">
                  <Input value={c.name} disabled={!admin} onChange={(e) => setForm({ ...form, categories: form.categories.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="font-semibold" />
                  {admin && <Button variant="ghost" icon={Trash2} onClick={() => setForm({ ...form, categories: form.categories.filter((_, j) => j !== i) })} aria-label="Remover categoria" />}
                </div>
                <p className="text-xs text-slate-500 mb-1">Subcategorias</p>
                {listEditor(c.subcategories, (v) => setForm({ ...form, categories: form.categories.map((x, j) => (j === i ? { ...x, subcategories: v } : x)) }), 'Subcategoria')}
              </div>
            ))}
            {admin && (
              <Button icon={Plus} onClick={() => setForm({ ...form, categories: [...form.categories, { name: '', subcategories: [] }] })}>
                Nova categoria
              </Button>
            )}
            <Notice>Renomear uma categoria não altera itens já cadastrados com o nome antigo (eles continuam aparecendo com esse nome).</Notice>
          </div>
        </Card>
      )}

      {tab === 'unidades' && (
        <Card title="Unidades de medida">
          <div className="space-y-2 max-w-lg">
            {form.units.map((u, i) => (
              <div key={i} className="flex gap-2">
                <Input value={u.code} disabled={!admin} className="w-24" placeholder="Sigla" onChange={(e) => setForm({ ...form, units: form.units.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) })} />
                <Input value={u.name} disabled={!admin} placeholder="Nome" onChange={(e) => setForm({ ...form, units: form.units.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                {admin && <Button variant="ghost" icon={Trash2} onClick={() => setForm({ ...form, units: form.units.filter((_, j) => j !== i) })} aria-label="Remover unidade" />}
              </div>
            ))}
            {admin && (
              <Button size="sm" icon={Plus} onClick={() => setForm({ ...form, units: [...form.units, { code: '', name: '' }] })}>
                Unidade
              </Button>
            )}
          </div>
        </Card>
      )}

      {tab === 'motivos' && (
        <Card title="Motivos de saída manual">
          <div className="max-w-lg space-y-4">
            {listEditor(form.exit_reasons, (v) => setForm({ ...form, exit_reasons: v }), 'Motivo')}
            <Checkbox checked={form.allow_negative_default} disabled={!admin} onChange={(v) => setForm({ ...form, allow_negative_default: v })} label="Sugerir 'permitir saldo negativo' em novos itens" />
          </div>
        </Card>
      )}

      {admin && tab !== 'locais' && (
        <div className="flex justify-end mt-4">
          <Button variant="primary" icon={Save} loading={saving} onClick={saveSettings}>
            Salvar configurações
          </Button>
        </div>
      )}

      <Modal
        open={!!loc}
        onClose={() => setLoc(null)}
        title={loc?.id ? 'Editar local' : 'Novo local'}
        footer={
          <>
            <Button onClick={() => setLoc(null)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={saveLoc}>
              Salvar
            </Button>
          </>
        }
      >
        {loc && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Código" required>
              <Input value={loc.code || ''} onChange={(e) => setLoc({ ...loc, code: e.target.value.toUpperCase() })} placeholder="DEP-02" />
            </Field>
            <Field label="Tipo" required>
              <Select value={loc.location_type} onChange={(e) => setLoc({ ...loc, location_type: e.target.value as LocationType })}>
                {Object.entries(LOCATION_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nome" required className="sm:col-span-2">
              <Input value={loc.name || ''} onChange={(e) => setLoc({ ...loc, name: e.target.value })} />
            </Field>
            <Field label="Endereço" className="sm:col-span-2">
              <Input value={loc.address || ''} onChange={(e) => setLoc({ ...loc, address: e.target.value })} />
            </Field>
            <Field label="Responsável" className="sm:col-span-2">
              <Input value={loc.responsible || ''} onChange={(e) => setLoc({ ...loc, responsible: e.target.value })} />
            </Field>
            {loc.id && <Checkbox checked={!!loc.active} onChange={(v) => setLoc({ ...loc, active: v })} label="Ativo (só inativa sem saldo e sem equipamentos)" />}
          </div>
        )}
      </Modal>
    </div>
  );
};
