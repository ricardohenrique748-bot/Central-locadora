/**
 * Caixa e bancos (contas, fechamento de caixa) e Lançamentos financeiros (todas as movimentações efetivas).
 */

import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Lock, Unlock, FileSpreadsheet, Undo2, Search, Receipt, Info } from 'lucide-react';
import { ACCOUNT_TYPE_LABELS, AccountType, CashSession, FinancialAccount, TRANSACTION_LABELS, Transaction, TransactionType } from '../../../../shared/financeiro/types';
import { financeCan } from '../../../../shared/financeiro/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Pagination, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useFin } from '../context';
import { AccountSelect, Amount, Th } from '../components';

export const AccountsView: React.FC = () => {
  const { accounts, user, reload, navigate } = useFin();
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<FinancialAccount> | null>(null);
  const [saving, setSaving] = useState(false);
  const sessions = useAsync(() => api.get<{ rows: CashSession[] }>('/finance/cash-sessions'), []);
  const [closing, setClosing] = useState<CashSession | null>(null);
  const [counted, setCounted] = useState(0);
  const [justification, setJustification] = useState('');

  const save = async () => {
    setSaving(true);
    try {
      if (edit?.id) await api.put(`/finance/accounts/${edit.id}`, edit);
      else await api.post('/finance/accounts', edit);
      toast('success', 'Conta salva.');
      setEdit(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };
  const total = accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  const openSession = (accId: number) => sessions.data?.rows.find((s) => s.account_id === accId && s.status === 'aberto');

  return (
    <div>
      <PageHeader
        title="Caixa e Bancos"
        subtitle={`Saldo total das contas ativas: ${formatBRL(total)} (saldo inicial + movimentações efetivadas).`}
        actions={
          financeCan.configure(user) && (
            <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', account_type: 'corrente', opening_balance: 0, opening_balance_date: todayISO(), active: true })}>
              Nova conta
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {accounts.map((a) => {
          const s = openSession(a.id);
          return (
            <div key={a.id} className={cx('bg-white rounded-xl border p-4', a.active ? 'border-slate-200' : 'border-slate-200 opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 truncate">{a.name}</p>
                  <p className="text-xs text-slate-500">
                    {ACCOUNT_TYPE_LABELS[a.account_type]}
                    {a.institution_name ? ` • ${a.institution_name}` : ''}
                    {a.account_reference ? ` • ${a.account_reference}` : ''}
                    {!a.active && ' • inativa'}
                  </p>
                </div>
                {financeCan.configure(user) && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(a)} aria-label="Editar conta" />}
              </div>
              <p className={cx('text-2xl font-extrabold tabular-nums mt-3', a.balance < 0 && 'text-red-700')}>{formatBRL(a.balance)}</p>
              <p className="text-[11px] text-slate-500">
                Conciliado: {formatBRL(a.reconciled_balance)} • Inicial {formatBRL(a.opening_balance)} em {formatDateBR(a.opening_balance_date)}
              </p>
              {a.pending_transfers !== 0 && <p className="text-[11px] text-amber-700">Transferências pendentes: {formatBRL(a.pending_transfers)}</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={() => navigate({ page: 'lancamentos', accountId: a.id })}>
                  Extrato
                </Button>
                {a.account_type === 'caixa' && a.active && financeCan.operate(user) && (
                  s ? (
                    <Button size="sm" variant="primary" icon={Lock} onClick={() => (setClosing(s), setCounted(s.expected_balance), setJustification(''))}>
                      Fechar caixa
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      icon={Unlock}
                      onClick={async () => {
                        try {
                          await api.post('/finance/cash-sessions', { account_id: a.id });
                          toast('success', 'Caixa aberto.');
                          sessions.reload();
                        } catch (e) {
                          toast('error', (e as Error).message);
                        }
                      }}
                    >
                      Abrir caixa
                    </Button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Card title="Aberturas e fechamentos de caixa" bodyClassName="p-0">
        {sessions.loading && !sessions.data ? (
          <Loading />
        ) : !sessions.data?.rows.length ? (
          <EmptyState title="Nenhum caixa aberto ou fechado ainda" text="Disponível para contas do tipo caixa físico." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Conta / abertura</Th>
                  <Th right>Saldo inicial</Th>
                  <Th right>Entradas</Th>
                  <Th right>Saídas</Th>
                  <Th right>Esperado</Th>
                  <Th right>Contado</Th>
                  <Th right>Diferença</Th>
                  <Th>Fechamento</Th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.rows.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2">
                      <p className="font-semibold">{s.account_name}</p>
                      <p className="text-[11px] text-slate-500">
                        {formatDateTimeBR(s.opened_at)} • {s.opened_by_name}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBRL(s.opening_balance)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatBRL(s.inflows)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-700">{formatBRL(s.outflows)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBRL(s.expected_balance)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.counted_amount === null ? '—' : formatBRL(s.counted_amount)}</td>
                    <td className="px-4 py-2 text-right">{s.difference === null ? '—' : <Amount v={s.difference} sign />}</td>
                    <td className="px-4 py-2 text-xs">
                      {s.status === 'aberto' ? (
                        <span className="text-amber-700 font-semibold">Aberto</span>
                      ) : (
                        <>
                          <p>
                            {formatDateTimeBR(s.closed_at)} • {s.closed_by_name}
                          </p>
                          {s.justification && <p className="text-slate-500">{s.justification}</p>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Editar conta' : 'Nova conta financeira'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              Salvar
            </Button>
          </>
        }
      >
        {edit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nome" required className="sm:col-span-2">
              <Input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select value={edit.account_type} onChange={(e) => setEdit({ ...edit, account_type: e.target.value as AccountType })}>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Banco / instituição">
              <Input value={edit.institution_name || ''} onChange={(e) => setEdit({ ...edit, institution_name: e.target.value })} />
            </Field>
            <Field label="Agência / conta">
              <Input value={edit.account_reference || ''} onChange={(e) => setEdit({ ...edit, account_reference: e.target.value })} />
            </Field>
            <Field label="Responsável">
              <Input value={edit.responsible || ''} onChange={(e) => setEdit({ ...edit, responsible: e.target.value })} />
            </Field>
            <Field label="Saldo inicial" hint="Base de todo o histórico: só pode mudar enquanto não houver movimentação">
              <MoneyInput value={Math.abs(edit.opening_balance || 0)} onChange={(v) => setEdit({ ...edit, opening_balance: (v ?? 0) * ((edit.opening_balance || 0) < 0 ? -1 : 1) })} />
            </Field>
            <Field label="Data do saldo inicial">
              <Input type="date" value={edit.opening_balance_date || ''} onChange={(e) => setEdit({ ...edit, opening_balance_date: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox checked={(edit.opening_balance || 0) < 0} onChange={(v) => setEdit({ ...edit, opening_balance: Math.abs(edit.opening_balance || 0) * (v ? -1 : 1) })} label="Saldo inicial negativo (cheque especial)" />
            </div>
            <Field label="Observações" className="sm:col-span-2">
              <Textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            {edit.id && <Checkbox checked={!!edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Conta ativa (só inativa com saldo zero)" />}
          </div>
        )}
      </Modal>

      <Modal
        open={!!closing}
        onClose={() => setClosing(null)}
        title={`Fechar caixa — ${closing?.account_name}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setClosing(null)}>Voltar</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api.post(`/finance/cash-sessions/${closing!.id}/close`, { counted_amount: counted, justification });
                  toast('success', 'Caixa fechado.');
                  setClosing(null);
                  sessions.reload();
                  reload();
                } catch (e) {
                  toast('error', (e as Error).message);
                }
              }}
            >
              Fechar caixa
            </Button>
          </>
        }
      >
        {closing && (
          <div className="space-y-3 text-sm">
            <p>
              Saldo inicial {formatBRL(closing.opening_balance)} + entradas {formatBRL(closing.inflows)} − saídas {formatBRL(closing.outflows)} = <b>esperado {formatBRL(closing.expected_balance)}</b>
            </p>
            <Field label="Valor contado em caixa" required>
              <MoneyInput value={counted} onChange={(v) => setCounted(v ?? 0)} />
            </Field>
            {counted !== closing.expected_balance && (
              <>
                <Notice kind="warning">Diferença de {formatBRL(counted - closing.expected_balance)}: vira um ajuste auditável na conta.</Notice>
                <Field label="Justificativa" required>
                  <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} />
                </Field>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export const TransactionsView: React.FC<{ initialAccount?: number }> = ({ initialAccount }) => {
  const { user, reload: reloadCtx } = useFin();
  const toast = useToast();
  const [account, setAccount] = useState<number | null>(initialAccount ?? null);
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reconciled, setReconciled] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [rev, setRev] = useState<Transaction | null>(null);
  const [reason, setReason] = useState('');
  const dq = useDebounced(q);
  const filters = { account_id: account, type, from, to, reconciled, q: dq };
  useEffect(() => setPage(1), [account, type, from, to, reconciled, dq]);
  const { data, error, loading, reload } = useAsync(() => api.get<{ total: number; page_size: number; rows: Transaction[] }>(`/finance/transactions${qs({ ...filters, page })}`), [account, type, from, to, reconciled, dq, page]);

  return (
    <div>
      <PageHeader
        title="Lançamentos Financeiros"
        subtitle="Movimentações efetivas nas contas: o que realmente entrou e saiu. Correções por estorno."
        actions={
          <Button
            icon={FileSpreadsheet}
            onClick={async () => {
              try {
                saveBlob(await fetchBlob(`/finance/transactions/export.csv${qs(filters)}`), `movimentacoes-${todayISO()}.csv`);
              } catch (e) {
                toast('error', (e as Error).message);
              }
            }}
          >
            CSV
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 p-4 border-b border-slate-100">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº ou descrição" className="pl-9" aria-label="Pesquisar" />
          </div>
          <AccountSelect value={account} onChange={setAccount} placeholder="Todas as contas" includeInactive />
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(TRANSACTION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={reconciled} onChange={(e) => setReconciled(e.target.value)} aria-label="Conciliação">
            <option value="">Conciliadas e não</option>
            <option value="1">Conciliadas</option>
            <option value="0">Não conciliadas</option>
          </Select>
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
          </div>
        </div>
        {!account && <p className="px-4 py-2 text-[11px] text-slate-500 border-b border-slate-100 flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Selecione uma conta para ver o saldo após cada movimentação.</p>}
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhuma movimentação" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Data / nº</Th>
                    <Th>Conta</Th>
                    <Th>Tipo / descrição</Th>
                    <Th right>Entrada</Th>
                    <Th right>Saída</Th>
                    {account && <Th right>Saldo após</Th>}
                    <Th>Situação</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className={cx(loading && 'opacity-60')}>
                  {data.rows.map((t) => (
                    <tr key={t.id} className={cx('border-t border-slate-100 align-top', !!t.reversed_by_id && 'text-slate-400')}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <p>{formatDateBR(t.transaction_date)}</p>
                        <p className="text-[11px] text-slate-500">{t.transaction_number}</p>
                      </td>
                      <td className="px-4 py-2">{t.account_name}</td>
                      <td className="px-4 py-2">
                        <p className="font-semibold">{TRANSACTION_LABELS[t.transaction_type as TransactionType] || t.transaction_type}</p>
                        <p className="text-xs text-slate-600 max-w-[320px]">{t.description}</p>
                        <p className="text-[10px] text-slate-400">{t.performed_by_name}</p>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{t.direction > 0 ? formatBRL(t.amount) : ''}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-700">{t.direction < 0 ? formatBRL(t.amount) : ''}</td>
                      {account && <td className="px-4 py-2 text-right">{t.balance_after === null ? '—' : <Amount v={t.balance_after} />}</td>}
                      <td className="px-4 py-2 text-xs">
                        <p className={t.status === 'pendente' ? 'text-amber-700 font-semibold' : ''}>{t.status === 'pendente' ? 'Pendente' : 'Efetivada'}</p>
                        {t.reconciled && <p className="text-emerald-700">Conciliada</p>}
                        {t.reversed_by_id && <p>Estornada</p>}
                        {t.reversal_of_id && <p>É estorno</p>}
                      </td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        {t.transaction_type === 'recebimento' && (
                          <Button size="sm" variant="ghost" icon={Receipt} title="Comprovante" aria-label="Comprovante" onClick={async () => window.open(URL.createObjectURL(await fetchBlob(`/finance/transactions/${t.id}/receipt`)), '_blank')} />
                        )}
                        {financeCan.reverse(user) && t.status === 'efetivada' && !t.reversed_by_id && !t.reversal_of_id && !t.transaction_type.startsWith('transferencia') && (
                          <Button size="sm" variant="ghost" icon={Undo2} className="text-red-700" title="Estornar" aria-label="Estornar" onClick={() => (setRev(t), setReason(''))} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal
        open={!!rev}
        onClose={() => setRev(null)}
        title={`Estornar ${rev?.transaction_number}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRev(null)}>Voltar</Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={async () => {
                try {
                  await api.post(`/finance/transactions/${rev!.id}/reverse`, { reason });
                  toast('success', 'Estorno registrado.');
                  setRev(null);
                  reload();
                  reloadCtx();
                } catch (e) {
                  toast('error', (e as Error).message);
                }
              }}
            >
              Estornar
            </Button>
          </>
        }
      >
        <Notice className="mb-3">Cria a movimentação inversa e devolve o valor às parcelas quitadas. Nada é apagado.</Notice>
        <Field label="Motivo" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
};
