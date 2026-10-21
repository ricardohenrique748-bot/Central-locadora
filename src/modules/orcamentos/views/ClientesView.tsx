/**
 * Cadastro de clientes: pesquisa por nome, documento ou telefone; criação e edição com validação.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Search, Pencil, AlertTriangle, MapPin, Building2, Loader2, History } from 'lucide-react';
import { Customer, CustomerInput, QuotationListRow } from '../../../../shared/orcamentos/types';
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, ContractListRow, PERIOD_NOUN } from '../../../../shared/contratos/types';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDocument, formatPhone, isValidCNPJ, missingDefinitiveData, onlyDigits, UF_LIST, validateCustomer } from '../../../../shared/orcamentos/validators';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { canInactivateCustomers, canManageCustomers } from '../../../../shared/orcamentos/permissions';
import { api, ApiError, qs } from '../api';
import { useModule } from '../context';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, Select, StatusBadge, Textarea, cx, useAsync, useDebounced, useToast } from '../ui';

const EMPTY: CustomerInput = {
  person_type: 'PJ',
  name: '',
  trade_name: null,
  document: null,
  state_registration: null,
  phone: null,
  whatsapp: null,
  email: null,
  postal_code: null,
  street: null,
  street_number: null,
  complement: null,
  neighborhood: null,
  city: null,
  state: null,
  notes: null,
  active: true,
};

export const CustomerFormModal: React.FC<{ open: boolean; customer?: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }> = ({ open, customer, onClose, onSaved }) => {
  const { user } = useModule();
  const toast = useToast();
  const [form, setForm] = useState<CustomerInput>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjInfo, setCnpjInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setForm(customer ? { ...customer } : EMPTY);
      setErrors({});
      setCnpjInfo(null);
    }
  }, [open, customer]);

  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const txt = (k: keyof CustomerInput) => ({
    value: (form[k] as string) || '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, (e.target.value || null) as never),
  });

  const lookupCep = async (raw = form.postal_code) => {
    const cep = onlyDigits(raw);
    if (cep.length !== 8) {
      setErrors((e) => ({ ...e, postal_code: 'CEP deve ter 8 dígitos.' }));
      return;
    }
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d.erro) throw new Error();
      setForm((f) =>
        onlyDigits(f.postal_code) !== cep
          ? f // o CEP mudou enquanto a busca rodava
          : { ...f, street: d.logradouro || f.street, complement: f.complement || d.complemento || null, neighborhood: d.bairro || f.neighborhood, city: d.localidade || f.city, state: d.uf || f.state }
      );
      // endereço preenchido: o próximo dado a digitar é o número
      if (d.logradouro) setTimeout(() => numberRef.current?.focus(), 0);
      setErrors((e) => ({ ...e, postal_code: '' }));
    } catch {
      setErrors((e) => ({ ...e, postal_code: 'CEP não encontrado ou serviço indisponível. Preencha manualmente.' }));
    } finally {
      setCepLoading(false);
    }
  };

  /** Consulta os dados públicos do CNPJ (Receita Federal, via BrasilAPI) e preenche só os campos ainda vazios. */
  const lookupCnpj = async (raw = form.document) => {
    const cnpj = onlyDigits(raw);
    if (cnpj.length !== 14 || !isValidCNPJ(cnpj)) {
      setErrors((e) => ({ ...e, document: 'CNPJ inválido: confira os dígitos.' }));
      setCnpjInfo(null);
      return;
    }
    setCnpjLoading(true);
    setCnpjInfo(null);
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (r.status === 404) throw new Error('CNPJ não encontrado na Receita Federal.');
      if (!r.ok) throw new Error('Consulta de CNPJ indisponível no momento. Preencha manualmente.');
      const d = await r.json();
      const up = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const tipo = up(d.descricao_tipo_de_logradouro);
      const logradouro = up(d.logradouro);
      const street = logradouro && tipo && !logradouro.toUpperCase().split(/\s+/).includes(tipo.toUpperCase()) ? `${tipo} ${logradouro}` : logradouro;
      const phone = onlyDigits(d.ddd_telefone_1 || '');
      const numero = up(d.numero);
      setForm((f) => {
        if (onlyDigits(f.document) !== cnpj) return f; // o CNPJ mudou enquanto a busca rodava
        const keep = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K] | null) => ((f[k] as unknown) ? f[k] : (v as CustomerInput[K]));
        return {
          ...f,
          name: keep('name', up(d.razao_social)) as string,
          trade_name: keep('trade_name', up(d.nome_fantasia)),
          phone: keep('phone', phone.length >= 10 ? phone : null),
          email: keep('email', up(d.email)?.toLowerCase() ?? null),
          postal_code: keep('postal_code', onlyDigits(d.cep || '') || null),
          street: keep('street', street),
          street_number: keep('street_number', numero && /^S\/?N$/i.test(numero) ? 'S/N' : numero),
          complement: keep('complement', up(d.complemento)),
          neighborhood: keep('neighborhood', up(d.bairro)),
          city: keep('city', up(d.municipio)),
          state: keep('state', up(d.uf)),
        };
      });
      const situacao = up(d.descricao_situacao_cadastral) || 'não informada';
      setCnpjInfo({
        ok: situacao.toUpperCase() === 'ATIVA',
        text: `Dados da Receita Federal • situação cadastral: ${situacao}${up(d.cnae_fiscal_descricao) ? ` • ${d.cnae_fiscal_descricao}` : ''}. Confira e complete o que faltar (inscrição estadual não vem nesta consulta).`,
      });
      setErrors((e) => ({ ...e, document: '' }));
    } catch (e) {
      setErrors((er) => ({ ...er, document: (e as Error).message.startsWith('CNPJ') || (e as Error).message.startsWith('Consulta') ? (e as Error).message : 'Consulta de CNPJ indisponível no momento. Preencha manualmente.' }));
    } finally {
      setCnpjLoading(false);
    }
  };

  const save = async () => {
    const local = validateCustomer(form);
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const saved = customer ? await api.put<Customer>(`/customers/${customer.id}`, form) : await api.post<Customer>('/customers', form);
      toast('success', customer ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      onSaved(saved);
    } catch (e) {
      const err = e as ApiError;
      if (err.fields) setErrors(err.fields);
      toast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const missing = missingDefinitiveData(form);
  const isPJ = form.person_type === 'PJ';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? 'Editar cliente' : 'Novo cliente'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Salvar cliente
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {missing.length > 0 && (
          <Notice kind="warning">
            Pode salvar assim para orçamentos preliminares. Para enviar uma proposta definitiva faltam: <b>{missing.join(', ')}</b>.
          </Notice>
        )}
        {isPJ && (cnpjLoading || cnpjInfo) && (
          <Notice kind={cnpjLoading || cnpjInfo!.ok ? 'info' : 'warning'}>
            {cnpjLoading ? 'Buscando os dados do CNPJ na Receita Federal...' : cnpjInfo!.ok ? cnpjInfo!.text : `Atenção: ${cnpjInfo!.text}`}
          </Notice>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          <Field label="Tipo de pessoa" required className="sm:col-span-2">
            <Select value={form.person_type} onChange={(e) => set('person_type', e.target.value as 'PF' | 'PJ')}>
              <option value="PJ">Pessoa jurídica</option>
              <option value="PF">Pessoa física</option>
            </Select>
          </Field>
          <Field label={isPJ ? 'CNPJ' : 'CPF'} error={errors.document} className="sm:col-span-2">
            <div className="flex gap-2">
              <Input
                value={formatDocument(form.document)}
                onChange={(e) => {
                  const doc = onlyDigits(e.target.value).slice(0, isPJ ? 14 : 11);
                  set('document', doc || null);
                  // CNPJ completo e diferente do anterior: busca os dados da empresa sozinho
                  if (isPJ && doc.length === 14 && doc !== onlyDigits(form.document)) lookupCnpj(doc);
                }}
                error={errors.document}
                placeholder={isPJ ? '00.000.000/0000-00' : '000.000.000-00'}
              />
              {isPJ && (
                <Button type="button" onClick={() => lookupCnpj()} disabled={cnpjLoading} aria-label="Buscar dados do CNPJ" title="Buscar dados na Receita Federal">
                  {cnpjLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
                </Button>
              )}
            </div>
          </Field>
          {isPJ && (
            <Field label="Inscrição estadual" className="sm:col-span-2">
              <Input {...txt('state_registration')} />
            </Field>
          )}
          <Field label={isPJ ? 'Razão social' : 'Nome completo'} required error={errors.name} className="sm:col-span-4">
            <Input {...txt('name')} error={errors.name} />
          </Field>
          <Field label="Nome fantasia" className="sm:col-span-2">
            <Input {...txt('trade_name')} />
          </Field>
        </div>

        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Contato</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Telefone" error={errors.phone}>
              <Input value={formatPhone(form.phone)} onChange={(e) => set('phone', onlyDigits(e.target.value).slice(0, 11) || null)} error={errors.phone} placeholder="(17) 3234-0000" />
            </Field>
            <Field label="WhatsApp" error={errors.whatsapp}>
              <Input value={formatPhone(form.whatsapp)} onChange={(e) => set('whatsapp', onlyDigits(e.target.value).slice(0, 11) || null)} error={errors.whatsapp} placeholder="(17) 99999-0000" />
            </Field>
            <Field label="E-mail" error={errors.email}>
              <Input type="email" {...txt('email')} error={errors.email} />
            </Field>
          </div>
        </div>

        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Endereço</p>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <Field label="CEP" error={errors.postal_code} className="sm:col-span-2">
              <div className="flex gap-2">
                <Input
                  value={(form.postal_code || '').replace(/(\d{5})(\d)/, '$1-$2')}
                  onChange={(e) => {
                    const cep = onlyDigits(e.target.value).slice(0, 8);
                    set('postal_code', cep || null);
                    // CEP completo e diferente do anterior: busca o endereço sozinho
                    if (cep.length === 8 && cep !== onlyDigits(form.postal_code)) lookupCep(cep);
                  }}
                  placeholder="00000-000"
                  inputMode="numeric"
                  error={errors.postal_code}
                />
                <Button type="button" icon={MapPin} loading={cepLoading} onClick={() => lookupCep()} title="Buscar endereço pelo CEP (ViaCEP)" aria-label="Buscar CEP" />
              </div>
            </Field>
            <Field label="Logradouro" className="sm:col-span-3">
              <Input {...txt('street')} />
            </Field>
            <Field label="Número" className="sm:col-span-1">
              <Input ref={numberRef} {...txt('street_number')} />
            </Field>
            <Field label="Complemento" className="sm:col-span-2">
              <Input {...txt('complement')} />
            </Field>
            <Field label="Bairro" className="sm:col-span-2">
              <Input {...txt('neighborhood')} />
            </Field>
            <Field label="Cidade" className="sm:col-span-1">
              <Input {...txt('city')} />
            </Field>
            <Field label="UF" error={errors.state} className="sm:col-span-1">
              <Select value={form.state || ''} onChange={(e) => set('state', e.target.value || null)}>
                <option value="">—</option>
                {UF_LIST.map((uf) => (
                  <option key={uf}>{uf}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <Field label="Observações comerciais">
          <Textarea {...txt('notes')} />
        </Field>

        {customer && (
          <Checkbox
            checked={form.active}
            onChange={(v) => set('active', v)}
            disabled={!canInactivateCustomers(user)}
            label={
              <span>
                Cliente ativo {!canInactivateCustomers(user) && <span className="text-xs text-slate-500">(somente gestor/administrador altera)</span>}
              </span>
            }
          />
        )}
      </div>
    </Modal>
  );
};

/** Orçamentos e contratos do cliente (o servidor aplica a visibilidade de cada perfil). */
const HistoryModal: React.FC<{ customer: Customer | null; onClose: () => void }> = ({ customer, onClose }) => {
  const { navigate, openContract } = useModule();
  const [quotes, setQuotes] = useState<QuotationListRow[] | null>(null);
  const [contracts, setContracts] = useState<ContractListRow[] | null>(null);
  const [contractsError, setContractsError] = useState<string | null>(null);
  useEffect(() => {
    if (!customer) return;
    setQuotes(null);
    setContracts(null);
    setContractsError(null);
    api.get<{ rows: QuotationListRow[] }>(`/quotations${qs({ customer_id: customer.id, page_size: 100 })}`).then((r) => setQuotes(r.rows)).catch(() => setQuotes([]));
    api
      .get<{ rows: ContractListRow[] }>(`/contracts${qs({ customer_id: customer.id, page_size: 100 })}`)
      .then((r) => setContracts(r.rows))
      .catch((e) => setContractsError((e as ApiError).status === 403 ? 'Seu perfil não acessa contratos.' : (e as Error).message));
  }, [customer?.id]);

  const rowCls = 'w-full text-left px-3 py-2.5 flex items-center justify-between gap-3 border-b border-slate-100 last:border-0';
  return (
    <Modal open={!!customer} onClose={onClose} title={`Histórico — ${customer?.name || ''}`} size="lg">
      <div className="space-y-5">
        <section>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Orçamentos {quotes && `(${quotes.length})`}</h3>
          {!quotes ? (
            <Loading />
          ) : !quotes.length ? (
            <p className="text-sm text-slate-500">Nenhum orçamento para este cliente.</p>
          ) : (
            <div className="border border-slate-200 rounded-lg">
              {quotes.map((o) => (
                <button key={o.id} type="button" onClick={() => (onClose(), navigate({ page: 'detalhe', id: o.id }))} className={cx(rowCls, 'hover:bg-slate-50')}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{o.quotation_number}</p>
                    <p className="text-xs text-slate-500">
                      {o.category === 'manutencao' ? 'Manutenção' : o.quotation_type === 'locacao' ? 'Locação' : 'Venda'} • {formatDateBR(o.created_at)} • {o.responsible_name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-slate-800">{formatBRL(o.total_amount)}</p>
                    <StatusBadge status={o.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        <section>
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Contratos {contracts && `(${contracts.length})`}</h3>
          {contractsError ? (
            <p className="text-sm text-slate-500">{contractsError}</p>
          ) : !contracts ? (
            <Loading />
          ) : !contracts.length ? (
            <p className="text-sm text-slate-500">Nenhum contrato para este cliente.</p>
          ) : (
            <div className="border border-slate-200 rounded-lg">
              {contracts.map((c) => (
                <button key={c.id} type="button" disabled={!openContract} onClick={() => (onClose(), openContract?.(c.contract_number))} className={cx(rowCls, openContract && 'hover:bg-slate-50')}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{c.contract_number}</p>
                    <p className="text-xs text-slate-500">
                      {CONTRACT_TYPE_LABELS[c.contract_type]} • {formatDateBR(c.start_date)} a {c.end_date ? formatDateBR(c.end_date) : 'indeterminado'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-slate-800">
                      {formatBRL(c.contract_type === 'venda' ? c.estimated_total ?? 0 : c.period_amount)}
                      {c.contract_type === 'locacao' && <span className="text-xs font-normal text-slate-500">{c.billing_frequency === 'unico' ? ' valor único' : ` /${PERIOD_NOUN[c.billing_frequency]}`}</span>}
                    </p>
                    <span className="text-[11px] font-semibold text-slate-600">{CONTRACT_STATUS_LABELS[c.status]}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};

export const ClientesView: React.FC<{ startNew?: number }> = ({ startNew }) => {
  const { user } = useModule();
  const [history, setHistory] = useState<Customer | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const dq = useDebounced(q);
  const pageSize = 20;

  useEffect(() => setPage(1), [dq, active]);
  // "Novo cliente" no menu principal abre o cadastro direto
  useEffect(() => {
    if (startNew && canManageCustomers(user)) {
      setEditing(null);
      setFormOpen(true);
    }
  }, [startNew]);
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; rows: Customer[] }>(`/customers${qs({ q: dq, active, limit: pageSize, offset: (page - 1) * pageSize })}`),
    [dq, active, page]
  );

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Cadastro único usado em orçamentos, contratos, entregas e financeiro. Inativar um cliente não altera documentos já emitidos."
        actions={
          canManageCustomers(user) && (
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Novo cliente
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar por nome, CPF/CNPJ ou telefone" className="pl-9" aria-label="Pesquisar clientes" />
          </div>
          <Select value={active} onChange={(e) => setActive(e.target.value)} className="sm:w-40" aria-label="Situação">
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
            <option value="">Todos</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum cliente encontrado" text={dq ? 'Tente outro termo de pesquisa.' : 'Cadastre o primeiro cliente para usar nos orçamentos.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Cliente</th>
                    <th className="text-left font-semibold px-4 py-2.5">CPF/CNPJ</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden md:table-cell">Contato</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden lg:table-cell">Cidade</th>
                    <th className="text-left font-semibold px-4 py-2.5 hidden lg:table-cell">Cadastro</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className={cx(loading && 'opacity-60')}>
                  {data.rows.map((c) => {
                    const missing = missingDefinitiveData(c);
                    return (
                      <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                            {c.name}
                            {!c.active && <span className="text-[10px] font-bold uppercase bg-slate-200 text-slate-600 px-1.5 rounded">Inativo</span>}
                          </p>
                          <p className="text-xs text-slate-500">
                            {c.person_type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}
                            {c.trade_name ? ` • ${c.trade_name}` : ''}
                          </p>
                          {missing.length > 0 && (
                            <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="w-3 h-3" /> Falta para proposta definitiva: {missing.join(', ')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">{formatDocument(c.document) || '—'}</td>
                        <td className="px-4 py-2.5 hidden md:table-cell text-slate-700">
                          <p>{formatPhone(c.phone || c.whatsapp) || '—'}</p>
                          <p className="text-xs text-slate-500">{c.email}</p>
                        </td>
                        <td className="px-4 py-2.5 hidden lg:table-cell text-slate-700">{c.city ? `${c.city}/${c.state || ''}` : '—'}</td>
                        <td className="px-4 py-2.5 hidden lg:table-cell text-slate-500">{formatDateBR(c.created_at)}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <Button size="sm" variant="ghost" icon={History} onClick={() => setHistory(c)}>
                            Histórico
                          </Button>
                          {canManageCustomers(user) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Pencil}
                              onClick={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                            >
                              Editar
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <HistoryModal customer={history} onClose={() => setHistory(null)} />
      <CustomerFormModal
        open={formOpen}
        customer={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          reload();
        }}
      />
    </div>
  );
};
