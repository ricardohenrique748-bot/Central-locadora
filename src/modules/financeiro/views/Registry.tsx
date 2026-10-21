/**
 * Plano de categorias (com grupo da DRE), centros de custo e configurações financeiras.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Save } from 'lucide-react';
import { CategoryType, CostCenter, DRE_GROUPS_BY_TYPE, DRE_LABELS, DreGroup, FinanceSettings, FinancialCategory } from '../../../../shared/financeiro/types';
import { financeCan } from '../../../../shared/financeiro/rules';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, Checkbox, Field, Input, Modal, MoneyInput, Notice, PageHeader, Select, Textarea, cx, useToast } from '../../orcamentos/ui';
import { useFin } from '../context';
import { CategorySelect, Th } from '../components';

export const CategoriesView: React.FC = () => {
  const { categories, user, reload } = useFin();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<FinancialCategory> | null>(null);
  const admin = financeCan.configure(user);
  const save = async () => {
    try {
      if (edit?.id) await api.put(`/finance/categories/${edit.id}`, edit);
      else await api.post('/finance/categories', edit);
      toast('success', 'Categoria salva.');
      setEdit(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  };
  const block = (type: CategoryType) => {
    const roots = categories.filter((c) => c.category_type === type && !c.parent_id);
    return (
      <Card
        title={type === 'receita' ? 'Receitas' : 'Despesas'}
        bodyClassName="p-0"
        actions={
          admin && (
            <Button size="sm" icon={Plus} onClick={() => setEdit({ category_type: type, name: '', parent_id: null, dre_group: DRE_GROUPS_BY_TYPE[type][0], active: true })}>
              Categoria
            </Button>
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-slate-50">
              <tr>
                <Th>Categoria</Th>
                <Th>Grupo da DRE</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {roots.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className={cx('border-t border-slate-100', !r.active && 'text-slate-400')}>
                    <td className="px-4 py-2 font-semibold">
                      {r.name} {!r.active && <span className="text-[10px] uppercase">(inativa)</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">{DRE_LABELS[r.dre_group]}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {admin && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEdit({ category_type: type, name: '', parent_id: r.id, dre_group: r.dre_group, active: true })}>
                            + sub
                          </Button>
                          <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(r)} aria-label="Editar" />
                        </>
                      )}
                    </td>
                  </tr>
                  {categories
                    .filter((c) => c.parent_id === r.id)
                    .map((c) => (
                      <tr key={c.id} className={cx('border-t border-slate-50', !c.active && 'text-slate-400')}>
                        <td className="px-4 py-1.5 pl-10">
                          › {c.name} {!c.active && <span className="text-[10px] uppercase">(inativa)</span>}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-slate-600">{DRE_LABELS[c.dre_group]}</td>
                        <td className="px-4 py-1.5 text-right">{admin && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(c)} aria-label="Editar" />}</td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };
  return (
    <div>
      <PageHeader title="Categorias Financeiras" subtitle="Plano de categorias (o quê). Não confundir com centro de custo (onde). Categorias inativas ficam no histórico, mas não aceitam novos lançamentos." />
      {!admin && <Notice className="mb-4">Somente o administrador altera o plano de categorias.</Notice>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {block('receita')}
        {block('despesa')}
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Editar categoria' : edit?.parent_id ? 'Nova subcategoria' : 'Nova categoria'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancelar</Button>
            <Button variant="primary" onClick={save}>
              Salvar
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Nome" required>
              <Input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Categoria pai (opcional)">
              <CategorySelect type={edit.category_type as CategoryType} value={edit.parent_id ?? null} onChange={(v) => setEdit({ ...edit, parent_id: v })} placeholder="— nível principal —" />
            </Field>
            <Field label="Grupo da DRE gerencial" hint={edit.dre_group === 'investimento' ? 'Investimento em patrimônio: fica fora do resultado da DRE.' : undefined}>
              <Select value={edit.dre_group} onChange={(e) => setEdit({ ...edit, dre_group: e.target.value as DreGroup })}>
                {DRE_GROUPS_BY_TYPE[edit.category_type as CategoryType].map((g) => (
                  <option key={g} value={g}>
                    {DRE_LABELS[g]}
                  </option>
                ))}
              </Select>
            </Field>
            {edit.id && <Checkbox checked={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativa" />}
          </div>
        )}
      </Modal>
    </div>
  );
};

export const CostCentersView: React.FC = () => {
  const { costCenters, user, reload } = useFin();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<CostCenter> | null>(null);
  const admin = financeCan.configure(user);
  return (
    <div>
      <PageHeader
        title="Centros de Custo"
        subtitle="Áreas/atividades para analisar resultado. Um lançamento pode ser rateado entre vários centros (a soma fecha o valor)."
        actions={admin && <Button variant="primary" icon={Plus} onClick={() => setEdit({ code: '', name: '', description: '', active: true })}>Novo centro</Button>}
      />
      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-slate-50">
              <tr>
                <Th>Código</Th>
                <Th>Nome</Th>
                <Th className="hidden md:table-cell">Descrição</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {costCenters.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold">{c.code}</td>
                  <td className="px-4 py-2.5 font-semibold">{c.name}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell text-slate-600">{c.description || '—'}</td>
                  <td className="px-4 py-2.5 text-xs">{c.active ? <span className="text-emerald-700 font-semibold">Ativo</span> : <span className="text-slate-500">Inativo</span>}</td>
                  <td className="px-4 py-2.5 text-right">{admin && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(c)} aria-label="Editar" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Editar centro de custo' : 'Novo centro de custo'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  if (edit?.id) await api.put(`/finance/cost-centers/${edit.id}`, edit);
                  else await api.post('/finance/cost-centers', edit);
                  toast('success', 'Centro de custo salvo.');
                  setEdit(null);
                  reload();
                } catch (e) {
                  toast('error', (e as ApiError).message);
                }
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-3">
            <Field label="Código" required>
              <Input value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Nome" required>
              <Input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Descrição">
              <Textarea value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            {edit.id && <Checkbox checked={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativo" />}
          </div>
        )}
      </Modal>
    </div>
  );
};

export const FinConfigView: React.FC = () => {
  const { settings, user, reload } = useFin();
  const toast = useToast();
  const [f, setF] = useState<FinanceSettings>(settings);
  const admin = financeCan.configure(user);
  useEffect(() => setF(settings), [settings]);
  return (
    <div>
      <PageHeader title="Configurações Financeiras" subtitle={admin ? 'Regras de alçada, prazos, conciliação e integrações.' : 'Visualização — alterações somente pelo administrador.'} />
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl">
          <Field label="Alçada de aprovação de pagamentos" hint="Contas a pagar acima deste valor precisam de aprovação de gestor/administrador. Zero = sem aprovação.">
            <MoneyInput value={f.payment_approval_limit} disabled={!admin} onChange={(v) => setF({ ...f, payment_approval_limit: v ?? 0 })} />
          </Field>
          <Field label="Prazo padrão de recebimento (dias)" hint="Usado nas cobranças geradas por vendas convertidas">
            <Input type="number" min={0} max={365} disabled={!admin} value={f.default_receivable_days} onChange={(e) => setF({ ...f, default_receivable_days: Number(e.target.value) })} />
          </Field>
          <Field label="Horizonte das recorrências (dias)" hint="Até quantos dias à frente as despesas/receitas recorrentes são geradas">
            <Input type="number" min={7} max={365} disabled={!admin} value={f.recurrence_horizon_days} onChange={(e) => setF({ ...f, recurrence_horizon_days: Number(e.target.value) })} />
          </Field>
          <div />
          <Field label="Categoria padrão — vendas convertidas">
            <CategorySelect type="receita" value={f.sale_category_id} onChange={(v) => setF({ ...f, sale_category_id: v })} />
          </Field>
          <Field label="Categoria padrão — contratos de locação (futuro)">
            <CategorySelect type="receita" value={f.rental_category_id} onChange={(v) => setF({ ...f, rental_category_id: v })} />
          </Field>
          <div className="md:col-span-2 space-y-2">
            <Checkbox checked={f.allow_negative_balance} disabled={!admin} onChange={(v) => setF({ ...f, allow_negative_balance: v })} label="Permitir que pagamentos deixem a conta com saldo negativo" />
            <Checkbox checked={f.auto_reconcile_exact} disabled={!admin} onChange={(v) => setF({ ...f, auto_reconcile_exact: v })} label="Conciliação automática somente para correspondência exata e única (mesma conta, data e valor, descrição compatível)" />
          </div>
        </div>
        {admin && (
          <div className="flex justify-end mt-5 pt-4 border-t border-slate-100">
            <Button
              variant="primary"
              icon={Save}
              onClick={async () => {
                try {
                  await api.put('/finance/settings', f);
                  toast('success', 'Configurações salvas.');
                  reload();
                } catch (e) {
                  toast('error', (e as ApiError).message);
                }
              }}
            >
              Salvar
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};
