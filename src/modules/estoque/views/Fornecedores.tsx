/**
 * Fornecedores: cadastro reutilizável (entradas, itens, patrimônio) e preparado para o Financeiro.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Search, Pencil } from 'lucide-react';
import { Supplier } from '../../../../shared/estoque/types';
import { validateSupplier } from '../../../../shared/estoque/validators';
import { formatDocument, formatPhone, onlyDigits, UF_LIST } from '../../../../shared/orcamentos/validators';
import { stockCan } from '../../../../shared/estoque/rules';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { Th } from '../components';

const EMPTY: Partial<Supplier> = { person_type: 'PJ', name: '', trade_name: null, document: null, state_registration: null, contact_name: null, phone: null, email: null, address: null, city: null, state: null, notes: null, active: true };

export const SupplierFormModal: React.FC<{ open: boolean; supplier?: Supplier | null; onClose: () => void; onSaved: (s: Supplier) => void }> = ({ open, supplier, onClose, onSaved }) => {
  const toast = useToast();
  const [form, setForm] = useState<Partial<Supplier>>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(supplier ? { ...supplier } : EMPTY);
      setErrors({});
    }
  }, [open, supplier]);
  const set = (k: keyof Supplier, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const e = validateSupplier(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const s = supplier ? await api.put<Supplier>(`/stock/suppliers/${supplier.id}`, form) : await api.post<Supplier>('/stock/suppliers', form);
      toast('success', supplier ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      onSaved(s);
    } catch (err) {
      const x = err as ApiError;
      if (x.fields) setErrors(x.fields);
      toast('error', x.message);
    } finally {
      setSaving(false);
    }
  };
  const pj = form.person_type !== 'PF';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Salvar fornecedor
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
        <Field label="Tipo" className="sm:col-span-2">
          <Select value={form.person_type} onChange={(e) => set('person_type', e.target.value)}>
            <option value="PJ">Pessoa jurídica</option>
            <option value="PF">Pessoa física</option>
          </Select>
        </Field>
        <Field label={pj ? 'CNPJ' : 'CPF'} error={errors.document} className="sm:col-span-2">
          <Input value={formatDocument(form.document)} onChange={(e) => set('document', onlyDigits(e.target.value).slice(0, pj ? 14 : 11) || null)} error={errors.document} />
        </Field>
        <Field label="Inscrição estadual" className="sm:col-span-2">
          <Input value={form.state_registration || ''} onChange={(e) => set('state_registration', e.target.value || null)} />
        </Field>
        <Field label={pj ? 'Razão social' : 'Nome'} required error={errors.name} className="sm:col-span-4">
          <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} error={errors.name} />
        </Field>
        <Field label="Nome fantasia" className="sm:col-span-2">
          <Input value={form.trade_name || ''} onChange={(e) => set('trade_name', e.target.value || null)} />
        </Field>
        <Field label="Contato" className="sm:col-span-2">
          <Input value={form.contact_name || ''} onChange={(e) => set('contact_name', e.target.value || null)} />
        </Field>
        <Field label="Telefone" error={errors.phone} className="sm:col-span-2">
          <Input value={formatPhone(form.phone)} onChange={(e) => set('phone', onlyDigits(e.target.value).slice(0, 11) || null)} error={errors.phone} />
        </Field>
        <Field label="E-mail" error={errors.email} className="sm:col-span-2">
          <Input type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value || null)} error={errors.email} />
        </Field>
        <Field label="Endereço" className="sm:col-span-3">
          <Input value={form.address || ''} onChange={(e) => set('address', e.target.value || null)} />
        </Field>
        <Field label="Cidade" className="sm:col-span-2">
          <Input value={form.city || ''} onChange={(e) => set('city', e.target.value || null)} />
        </Field>
        <Field label="UF" className="sm:col-span-1">
          <Select value={form.state || ''} onChange={(e) => set('state', e.target.value || null)}>
            <option value="">—</option>
            {UF_LIST.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
        <Field label="Observações" className="sm:col-span-6">
          <Textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value || null)} />
        </Field>
        {supplier && <Checkbox checked={!!form.active} onChange={(v) => set('active', v)} label="Fornecedor ativo" />}
      </div>
    </Modal>
  );
};

export const FornecedoresView: React.FC = () => {
  const { user } = useStock();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: Supplier[] }>(`/stock/suppliers${qs({ q: dq })}`), [dq]);
  return (
    <div>
      <PageHeader
        title="Fornecedores"
        subtitle="Cadastro reutilizável nas entradas, itens e patrimônio. Preparado para o vínculo com contas a pagar (Financeiro)."
        actions={
          stockCan.manageSuppliers(user) && (
            <Button variant="primary" icon={Plus} onClick={() => (setEditing(null), setOpen(true))}>
              Novo fornecedor
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-7 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou CNPJ/CPF" className="pl-9" aria-label="Pesquisar fornecedores" />
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum fornecedor" text="Cadastre fornecedores para registrar compras." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Fornecedor</Th>
                  <Th>CNPJ/CPF</Th>
                  <Th className="hidden md:table-cell">Contato</Th>
                  <Th className="hidden lg:table-cell">Cidade</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-slate-800">
                        {s.name} {!s.active && <span className="text-[10px] uppercase bg-slate-200 text-slate-600 px-1.5 rounded">Inativo</span>}
                      </p>
                      {s.trade_name && <p className="text-xs text-slate-500">{s.trade_name}</p>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{formatDocument(s.document) || '—'}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <p>{s.contact_name || '—'}</p>
                      <p className="text-xs text-slate-500">{[formatPhone(s.phone), s.email].filter(Boolean).join(' • ')}</p>
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">{s.city ? `${s.city}/${s.state || ''}` : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {stockCan.manageSuppliers(user) && (
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => (setEditing(s), setOpen(true))}>
                          Editar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <SupplierFormModal open={open} supplier={editing} onClose={() => setOpen(false)} onSaved={() => (setOpen(false), reload())} />
    </div>
  );
};
