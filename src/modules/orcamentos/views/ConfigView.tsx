/**
 * Configurações do módulo: empresa, regras comerciais, política de locação,
 * usuários e permissões (administrador) e troca de senha (todos).
 */

import React, { useEffect, useState } from 'react';
import { Save, Plus, Pencil, Trash2, ImagePlus, KeyRound, CheckCircle2, CircleSlash } from 'lucide-react';
import { ModuleSettings, Role, ROLE_LABELS, AuthUser } from '../../../../shared/orcamentos/types';
import { canManageSettings } from '../../../../shared/orcamentos/permissions';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError } from '../api';
import { useModule } from '../context';
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select, cx, useAsync, useToast } from '../ui';

const TABS = [
  ['empresa', 'Empresa'],
  ['regras', 'Regras comerciais'],
  ['locacao', 'Locação'],
  ['usuarios', 'Usuários'],
  ['integracoes', 'Integrações'],
  ['senha', 'Minha senha'],
] as const;
type Tab = (typeof TABS)[number][0];

const SettingsForm: React.FC<{ section: 'empresa' | 'regras' | 'locacao' }> = ({ section }) => {
  const { settings, reloadSettings, user } = useModule();
  const toast = useToast();
  const [form, setForm] = useState<ModuleSettings>(settings);
  const [saving, setSaving] = useState(false);
  const readOnly = !canManageSettings(user);
  useEffect(() => setForm(settings), [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', form);
      toast('success', 'Configurações salvas.');
      reloadSettings();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const company = (k: keyof ModuleSettings['company'], label: string, span = '') => (
    <Field label={label} className={span}>
      <Input value={(form.company[k] as string) || ''} disabled={readOnly} onChange={(e) => setForm({ ...form, company: { ...form.company, [k]: e.target.value } })} />
    </Field>
  );

  return (
    <Card>
      {readOnly && <Notice className="mb-4">Somente o administrador altera estas configurações.</Notice>}
      {section === 'empresa' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {company('name', 'Nome comercial (aparece no PDF)')}
          {company('legal_name', 'Razão social')}
          {company('document', 'CNPJ')}
          {company('phone', 'Telefone')}
          {company('email', 'E-mail')}
          {company('address', 'Endereço completo', 'md:col-span-2')}
          <Field label="Logotipo do PDF (PNG ou JPG, até ~500 KB)" className="md:col-span-2">
            <div className="flex items-center gap-3">
              {form.company.logo_data ? <img src={form.company.logo_data} alt="Logotipo" className="h-14 max-w-[160px] object-contain border border-slate-200 rounded p-1 bg-white" /> : <div className="h-14 w-28 rounded bg-slate-100 text-xs text-slate-400 flex items-center justify-center">Sem logo</div>}
              {!readOnly && (
                <>
                  <label className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                    <ImagePlus className="w-4 h-4" /> Escolher
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        if (f.size > 500_000) {
                          toast('error', 'Imagem muito grande (máx. 500 KB).');
                          return;
                        }
                        const r = new FileReader();
                        r.onload = () => setForm((s) => ({ ...s, company: { ...s.company, logo_data: String(r.result) } }));
                        r.readAsDataURL(f);
                      }}
                    />
                  </label>
                  {form.company.logo_data && <Button variant="ghost" icon={Trash2} onClick={() => setForm({ ...form, company: { ...form.company, logo_data: null } })} aria-label="Remover logotipo" />}
                </>
              )}
            </div>
          </Field>
        </div>
      )}

      {section === 'regras' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Validade padrão da proposta (dias)">
              <Input type="number" min={1} max={365} disabled={readOnly} value={form.default_validity_days} onChange={(e) => setForm({ ...form, default_validity_days: Number(e.target.value) })} />
            </Field>
            <Field label="Avisar vencimento com antecedência de (dias)">
              <Input type="number" min={1} max={60} disabled={readOnly} value={form.expiring_soon_days} onChange={(e) => setForm({ ...form, expiring_soon_days: Number(e.target.value) })} />
            </Field>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Alçadas de desconto</p>
            <p className="text-xs text-slate-500 mb-3">Desconto efetivo máximo (redução sobre a tabela + descontos dos itens + desconto geral) que cada perfil aprova sem escalar.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(['vendedor', 'gestor', 'admin'] as const).map((r) => (
                <Field key={r} label={`${ROLE_LABELS[r]} (%)`}>
                  <Input type="number" min={0} max={100} step={0.5} disabled={readOnly} value={form.discount_limits[r]} onChange={(e) => setForm({ ...form, discount_limits: { ...form.discount_limits, [r]: Number(e.target.value) } })} />
                </Field>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Checkbox checked={form.seller_can_change_price} disabled={readOnly} onChange={(v) => setForm({ ...form, seller_can_change_price: v })} label="Vendedor pode alterar o preço de tabela no orçamento (a redução conta na alçada)" />
            <Checkbox checked={form.require_internal_approval} disabled={readOnly} onChange={(v) => setForm({ ...form, require_internal_approval: v })} label="Exigir aprovação de gestor/administrador em todo orçamento antes do envio" />
          </div>
        </div>
      )}

      {section === 'locacao' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Contagem de dias" hint={form.rental_policy.day_count_mode === 'exclusive' ? 'Ex.: retira dia 01, devolve dia 02 = 1 diária' : 'Ex.: retira dia 01, devolve dia 02 = 2 diárias'}>
              <Select disabled={readOnly} value={form.rental_policy.day_count_mode} onChange={(e) => setForm({ ...form, rental_policy: { ...form.rental_policy, day_count_mode: e.target.value as 'exclusive' | 'inclusive' } })}>
                <option value="exclusive">Término − início (dias corridos)</option>
                <option value="inclusive">Inclui o dia de início e o de término</option>
              </Select>
            </Field>
            <Field label="Dias do mês comercial" hint="Usado na cobrança mensal">
              <Input type="number" min={28} max={31} disabled={readOnly} value={form.rental_policy.days_per_month} onChange={(e) => setForm({ ...form, rental_policy: { ...form.rental_policy, days_per_month: Number(e.target.value) } })} />
            </Field>
          </div>
          <Checkbox
            checked={form.rental_policy.proportional}
            disabled={readOnly}
            onChange={(v) => setForm({ ...form, rental_policy: { ...form.rental_policy, proportional: v } })}
            label="Cobrança proporcional de semanas/meses (10 dias = 1,43 semana)"
          />
          <Notice>
            {form.rental_policy.proportional
              ? 'Semanas e meses são fracionados com 2 casas decimais. Nenhum arredondamento para cima.'
              : 'Semanas e meses são cobrados por período fechado: frações são arredondadas para cima e o arredondamento aparece destacado na memória de cálculo do orçamento e no PDF (coluna Períodos).'}
          </Notice>
        </div>
      )}

      {!readOnly && (
        <div className="flex justify-end mt-5 pt-4 border-t border-slate-100">
          <Button variant="primary" icon={Save} loading={saving} onClick={save}>
            Salvar
          </Button>
        </div>
      )}
    </Card>
  );
};

type UserRow = AuthUser & { created_at: string };

const UsersPanel: React.FC = () => {
  const { user } = useModule();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: UserRow[] }>('/users'), []);
  const [editing, setEditing] = useState<(Partial<UserRow> & { password?: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      if (editing?.id) await api.put(`/users/${editing.id}`, editing);
      else await api.post('/users', editing);
      toast('success', 'Usuário salvo.');
      setEditing(null);
      reload();
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields || {});
      toast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <Card
      title="Usuários e perfis"
      bodyClassName="p-0"
      actions={
        <Button
          size="sm"
          variant="primary"
          icon={Plus}
          onClick={() => {
            setErrors({});
            setEditing({ name: '', email: '', role: 'vendedor', active: true, password: '' });
          }}
        >
          Novo usuário
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">Nome</th>
              <th className="text-left font-semibold px-4 py-2.5">E-mail</th>
              <th className="text-left font-semibold px-4 py-2.5">Perfil</th>
              <th className="text-left font-semibold px-4 py-2.5">Situação</th>
              <th className="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Desde</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {data!.rows.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-semibold text-slate-800">
                  {u.name} {u.id === user.id && <span className="text-[10px] text-slate-500">(você)</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{u.email}</td>
                <td className="px-4 py-2.5">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 py-2.5">
                  {u.active ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-500 text-xs font-semibold">
                      <CircleSlash className="w-3.5 h-3.5" /> Inativo
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 hidden md:table-cell text-slate-500">{formatDateBR(u.created_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Pencil}
                    onClick={() => {
                      setErrors({});
                      setEditing({ ...u, password: '' });
                    }}
                  >
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-500 space-y-0.5">
        <p>
          <b>Administrador:</b> tudo, inclusive usuários e alçadas. <b>Gestor:</b> vê todos os orçamentos, aprova dentro da alçada, mantém o catálogo.
        </p>
        <p>
          <b>Vendedor:</b> cria e acompanha os próprios orçamentos. <b>Consulta:</b> somente leitura.
        </p>
      </div>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar usuário' : 'Novo usuário'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Salvar
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Nome" required error={errors.name}>
              <Input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} error={errors.name} />
            </Field>
            <Field label="E-mail (login)" required error={errors.email}>
              <Input type="email" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} error={errors.email} />
            </Field>
            <Field label="Perfil" required error={errors.role}>
              <Select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={editing.id ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial'} required={!editing.id} error={errors.password} hint="Mínimo de 8 caracteres">
              <Input type="password" autoComplete="new-password" value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} error={errors.password} />
            </Field>
            {editing.id && <Checkbox checked={!!editing.active} disabled={editing.id === user.id} onChange={(v) => setEditing({ ...editing, active: v })} label="Usuário ativo" />}
            {editing.id && <p className="text-[11px] text-slate-500">Inativar ou trocar a senha encerra as sessões abertas desse usuário.</p>}
          </div>
        )}
      </Modal>
    </Card>
  );
};

const PasswordPanel: React.FC = () => {
  const toast = useToast();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (form.new_password !== form.confirm) {
      setErrors({ confirm: 'As senhas não conferem.' });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      await api.put('/auth/password', form);
      toast('success', 'Senha alterada.');
      setForm({ current_password: '', new_password: '', confirm: '' });
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields || {});
      toast('error', err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title="Alterar minha senha" className="max-w-md">
      <div className="space-y-3">
        <Field label="Senha atual" error={errors.current_password}>
          <Input type="password" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} error={errors.current_password} />
        </Field>
        <Field label="Nova senha" error={errors.new_password} hint="Mínimo de 8 caracteres">
          <Input type="password" autoComplete="new-password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} error={errors.new_password} />
        </Field>
        <Field label="Confirmar nova senha" error={errors.confirm}>
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} />
        </Field>
        <Button variant="primary" icon={KeyRound} loading={saving} onClick={save} disabled={!form.current_password || !form.new_password}>
          Alterar senha
        </Button>
      </div>
    </Card>
  );
};

const IntegrationsPanel: React.FC = () => {
  const { integrations } = useModule();
  const rows: [string, boolean, string][] = [
    ['Estoque', integrations.estoque, 'Consulta e reserva de disponibilidade, baixa de produtos após venda confirmada. Sem ela, a disponibilidade fica "não verificada".'],
    ['Vendas', integrations.venda, 'Conversão de orçamento de venda aprovado em operação de venda (idempotente).'],
    ['Contratos de locação', integrations.contrato_locacao, 'Conversão de orçamento de locação aprovado em contrato, com validação de conflito de datas.'],
    ['Financeiro', integrations.financeiro, 'Contas a receber, caução e inadimplência após a operação efetivada.'],
    ['Envio automático (e-mail/WhatsApp)', false, 'Hoje o sistema prepara a mensagem e baixa o PDF; o envio é feito pelo usuário e registrado manualmente.'],
  ];
  return (
    <Card title="Integrações com módulos futuros">
      <ul className="divide-y divide-slate-100">
        {rows.map(([name, on, desc]) => (
          <li key={name} className="py-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">{name}</p>
              <p className="text-xs text-slate-500">{desc}</p>
            </div>
            <span className={cx('text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap', on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>{on ? 'Ativa' : 'Não implementada'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export const ConfigView: React.FC = () => {
  const { user } = useModule();
  const admin = canManageSettings(user);
  const tabs = TABS.filter(([k]) => k !== 'usuarios' || admin);
  const [tab, setTab] = useState<Tab>('empresa');
  return (
    <div>
      <PageHeader title="Configurações" subtitle={admin ? 'Parâmetros do módulo de orçamentos.' : 'Visualização das regras do módulo. Alterações somente pelo administrador.'} />
      <div className="flex gap-1 overflow-x-auto mb-4 pb-1">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap', tab === k ? 'bg-[#1e3a5f] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50')}>
            {l}
          </button>
        ))}
      </div>
      {(tab === 'empresa' || tab === 'regras' || tab === 'locacao') && <SettingsForm section={tab} />}
      {tab === 'usuarios' && admin && <UsersPanel />}
      {tab === 'integracoes' && <IntegrationsPanel />}
      {tab === 'senha' && <PasswordPanel />}
    </div>
  );
};
