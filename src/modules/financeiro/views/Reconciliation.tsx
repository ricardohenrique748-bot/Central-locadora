/**
 * Conciliação bancária: importar extrato (CSV/OFX), conferir sugestões e confirmar.
 */

import React, { useState } from 'react';
import { Upload, Link2, Unlink, AlertTriangle, EyeOff, RotateCcw, FilePlus2, Info } from 'lucide-react';
import { StatementItem } from '../../../../shared/financeiro/types';
import { financeCan } from '../../../../shared/financeiro/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useFin } from '../context';
import { AccountSelect, Amount, CategorySelect, StatementPill, Th } from '../components';

export const ReconciliationView: React.FC = () => {
  const { user, accounts, reload: reloadCtx, costCenters } = useFin();
  const toast = useToast();
  const [account, setAccount] = useState<number | null>(accounts.find((a) => a.account_type !== 'caixa' && a.active)?.id ?? null);
  const [status, setStatus] = useState('pendente');
  const items = useAsync(() => (account ? api.get<{ rows: StatementItem[]; summary: any[] }>(`/finance/reconciliation/items${qs({ account_id: account, status })}`) : Promise.resolve({ rows: [], summary: [] })), [account, status]);
  const imports = useAsync(() => api.get<{ rows: any[] }>('/finance/reconciliation/imports'), []);
  const [busy, setBusy] = useState(false);
  const [noteFor, setNoteFor] = useState<{ item: StatementItem; action: 'divergente' | 'ignorar' } | null>(null);
  const [note, setNote] = useState('');
  const [createFor, setCreateFor] = useState<StatementItem | null>(null);
  const [create, setCreate] = useState<{ category_id: number | null; cost_center_id: string; description: string; party_name: string }>({ category_id: null, cost_center_id: '', description: '', party_name: '' });
  const [manual, setManual] = useState<{ item: StatementItem; tx: string } | null>(null);

  const act = async (item: StatementItem, action: string, body: any = {}, ok = 'Atualizado.') => {
    setBusy(true);
    try {
      await api.post(`/finance/reconciliation/items/${item.id}/${action}`, body);
      toast('success', ok);
      items.reload();
      imports.reload();
      reloadCtx();
      return true;
    } catch (e) {
      toast('error', (e as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file?: File) => {
    if (!file || !account) return;
    if (file.size > 3_000_000) return toast('error', 'Arquivo muito grande.');
    setBusy(true);
    try {
      const content = await file.text();
      const r = await api.post<{ imported: number; duplicates: number; auto_matched: number; warnings: string[] }>('/finance/reconciliation/import', { account_id: account, file_name: file.name, content });
      toast('success', `${r.imported} transação(ões) importada(s)${r.duplicates ? `, ${r.duplicates} duplicada(s) sinalizada(s)` : ''}${r.auto_matched ? `, ${r.auto_matched} conciliada(s) pela regra exata` : ''}.`);
      if (r.warnings.length) toast('info', r.warnings.slice(0, 3).join(' '));
      items.reload();
      imports.reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const summary = (s: string) => items.data?.summary.find((x: any) => x.status === s)?.n || 0;

  return (
    <div>
      <PageHeader title="Conciliação Bancária" subtitle="Compare o extrato do banco com as movimentações do sistema. Conciliar não cria receita nem despesa." />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Conta" className="w-full sm:w-72">
          <AccountSelect value={account} onChange={setAccount} />
        </Field>
        <Field label="Situação" className="w-full sm:w-48">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pendente">Não conciliados ({summary('pendente')})</option>
            <option value="conciliado">Conciliados ({summary('conciliado')})</option>
            <option value="divergente">Divergentes ({summary('divergente')})</option>
            <option value="duplicado">Duplicados ({summary('duplicado')})</option>
            <option value="ignorado">Ignorados ({summary('ignorado')})</option>
            <option value="">Todos</option>
          </Select>
        </Field>
        {financeCan.operate(user) && account && (
          <label className={cx('inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-[#1e3a5f] text-white hover:bg-[#16304f] cursor-pointer', busy && 'opacity-60')}>
            <Upload className="w-4 h-4" /> Importar extrato (CSV ou OFX)
            <input type="file" accept=".csv,.txt,.ofx" className="hidden" onChange={(e) => (importFile(e.target.files?.[0]), (e.target.value = ''))} />
          </label>
        )}
      </div>
      <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2.5 mb-4">
        <Info className="w-4 h-4 shrink-0 text-slate-400 mt-px" />
        <p>
          CSV: colunas <b>data; descrição; valor</b> (opcional: documento) — aceita 05/10/2026, "1.500,00" e "-29,90". OFX: padrão dos bancos. As sugestões só consideram mesma conta e mesmo valor, pontuando data (±5 dias), descrição e referência — <b>valor igual sozinho não concilia</b>. Itens já importados aparecem como duplicados.
        </p>
      </div>

      <Card bodyClassName="p-0">
        {!account ? (
          <EmptyState title="Selecione a conta bancária" />
        ) : items.loading && !items.data ? (
          <Loading />
        ) : items.error ? (
          <ErrorState message={items.error} onRetry={items.reload} />
        ) : !items.data?.rows.length ? (
          <EmptyState title="Nada aqui" text={status === 'pendente' ? 'Sem itens pendentes. Importe um extrato para começar.' : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Data</Th>
                  <Th>Descrição (extrato)</Th>
                  <Th right>Valor</Th>
                  <Th>Situação</Th>
                  <Th>Correspondência</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.data.rows.map((it) => (
                  <tr key={it.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDateBR(it.transaction_date)}</td>
                    <td className="px-4 py-2.5">
                      <p>{it.description}</p>
                      {it.external_reference && <p className="text-[11px] text-slate-500">Ref. {it.external_reference}</p>}
                      {it.note && <p className="text-[11px] text-amber-700">{it.note}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Amount v={it.amount} sign />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatementPill s={it.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {it.status === 'conciliado' && <p className="font-semibold text-emerald-700">{it.matched_transaction_number}</p>}
                      {it.status === 'pendente' &&
                        (it.suggestions?.length ? (
                          <ul className="space-y-1">
                            {it.suggestions.map((s) => (
                              <li key={s.transaction_id} className="flex items-center gap-2">
                                <span className={cx('px-1.5 rounded text-[10px] font-bold', s.score >= 80 ? 'bg-emerald-100 text-emerald-800' : s.score >= 60 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>{s.score}%</span>
                                <span className="truncate max-w-[220px]" title={s.description}>
                                  {s.transaction_number} • {formatDateBR(s.transaction_date)}
                                </span>
                                {financeCan.operate(user) && (
                                  <Button size="sm" variant="ghost" icon={Link2} loading={busy} onClick={() => act(it, 'conciliar', { transaction_id: s.transaction_id }, 'Conciliado.')}>
                                    Conciliar
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-500">Sem movimentação correspondente no sistema.</span>
                        ))}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {financeCan.operate(user) && it.status === 'pendente' && (
                        <>
                          <Button size="sm" variant="ghost" icon={FilePlus2} title="Criar lançamento (tarifa, rendimento...)" onClick={() => (setCreateFor(it), setCreate({ category_id: null, cost_center_id: '', description: it.description, party_name: '' }))}>
                            Lançar
                          </Button>
                          <Button size="sm" variant="ghost" title="Conciliar com movimentação pelo número" onClick={() => setManual({ item: it, tx: '' })}>
                            Nº
                          </Button>
                          <Button size="sm" variant="ghost" icon={AlertTriangle} title="Divergente" aria-label="Divergente" onClick={() => (setNoteFor({ item: it, action: 'divergente' }), setNote(''))} />
                          <Button size="sm" variant="ghost" icon={EyeOff} title="Ignorar" aria-label="Ignorar" onClick={() => (setNoteFor({ item: it, action: 'ignorar' }), setNote(''))} />
                        </>
                      )}
                      {financeCan.operate(user) && it.status === 'conciliado' && (
                        <Button size="sm" variant="ghost" icon={Unlink} onClick={() => act(it, 'desfazer', {}, 'Conciliação desfeita.')}>
                          Desfazer
                        </Button>
                      )}
                      {financeCan.operate(user) && ['divergente', 'ignorado', 'duplicado'].includes(it.status) && (
                        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => act(it, 'reabrir', {}, 'Reaberto.')}>
                          Reabrir
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

      <Card title="Importações" className="mt-5" bodyClassName="p-0">
        {!imports.data?.rows.length ? (
          <p className="text-sm text-slate-500 text-center py-6">Nenhum extrato importado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Arquivo</Th>
                  <Th>Conta</Th>
                  <Th right>Itens</Th>
                  <Th right>Conciliados</Th>
                  <Th right>Pendentes</Th>
                  <Th>Importado</Th>
                </tr>
              </thead>
              <tbody>
                {imports.data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{r.file_name}</td>
                    <td className="px-4 py-2">{r.account_name}</td>
                    <td className="px-4 py-2 text-right">{r.items}</td>
                    <td className="px-4 py-2 text-right text-emerald-700">{r.matched}</td>
                    <td className="px-4 py-2 text-right text-amber-700">{r.pending}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatDateTimeBR(r.created_at)} • {r.imported_by_name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        title={noteFor?.action === 'divergente' ? 'Registrar divergência' : 'Ignorar item'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setNoteFor(null)}>Voltar</Button>
            <Button variant="primary" loading={busy} onClick={async () => (await act(noteFor!.item, noteFor!.action, { note })) && setNoteFor(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        <Field label="Descrição" required>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={noteFor?.action === 'divergente' ? 'Ex.: banco debitou valor diferente do boleto' : 'Ex.: lançamento de teste do banco'} />
        </Field>
      </Modal>

      <Modal
        open={!!createFor}
        onClose={() => setCreateFor(null)}
        title="Criar lançamento a partir do extrato"
        footer={
          <>
            <Button onClick={() => setCreateFor(null)}>Cancelar</Button>
            <Button variant="primary" loading={busy} disabled={!create.category_id} onClick={async () => (await act(createFor!, 'criar_lancamento', create, 'Lançamento criado, liquidado e conciliado.')) && setCreateFor(null)}>
              Criar e conciliar
            </Button>
          </>
        }
      >
        {createFor && (
          <div className="space-y-3">
            <Notice>
              {createFor.amount < 0 ? 'Despesa' : 'Receita'} de {formatBRL(Math.abs(createFor.amount))} em {formatDateBR(createFor.transaction_date)} que só aparece no extrato (tarifa, rendimento, débito automático). O sistema cria o lançamento já liquidado e vinculado — não há duplicidade.
            </Notice>
            <Field label="Categoria" required>
              <CategorySelect type={createFor.amount < 0 ? 'despesa' : 'receita'} value={create.category_id} onChange={(v) => setCreate({ ...create, category_id: v })} />
            </Field>
            <Field label="Descrição">
              <Input value={create.description} onChange={(e) => setCreate({ ...create, description: e.target.value })} />
            </Field>
            <Field label="Favorecido / pagador">
              <Input value={create.party_name} onChange={(e) => setCreate({ ...create, party_name: e.target.value })} placeholder="Banco / extrato" />
            </Field>
            <Field label="Centro de custo (opcional)">
              <Select value={create.cost_center_id} onChange={(e) => setCreate({ ...create, cost_center_id: e.target.value })}>
                <option value="">—</option>
                {costCenters.filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!manual}
        onClose={() => setManual(null)}
        title="Conciliar com movimentação específica"
        size="sm"
        footer={
          <>
            <Button onClick={() => setManual(null)}>Voltar</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                try {
                  const r = await api.get<{ rows: { id: number }[] }>(`/finance/transactions${qs({ q: manual!.tx, account_id: account })}`);
                  if (!r.rows.length) return toast('error', 'Movimentação não encontrada nesta conta.');
                  if ((await act(manual!.item, 'conciliar', { transaction_id: r.rows[0].id }, 'Conciliado.'))) setManual(null);
                } catch (e) {
                  toast('error', (e as Error).message);
                }
              }}
            >
              Conciliar
            </Button>
          </>
        }
      >
        <Field label="Número da movimentação (FIN-...)" hint="Valor e conta precisam ser iguais aos do extrato">
          <Input value={manual?.tx || ''} onChange={(e) => setManual(manual && { ...manual, tx: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
};
