/**
 * Controle de avarias e ocorrências: análise, responsabilidade, aprovação e envio ao Financeiro.
 * Cobrança nunca é automática.
 */

import React, { useState } from 'react';
import { Search, Paperclip } from 'lucide-react';
import { OCCURRENCE_STATUS_LABELS, OCCURRENCE_TYPE_LABELS, Occurrence, OccurrenceStatus, RESPONSIBILITY_LABELS, Responsibility } from '../../../../shared/logistica/types';
import { logCan } from '../../../../shared/logistica/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, PageHeader, Select, Textarea, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { readFile, useLog } from '../context';
import { OccPill, Th } from '../components';

type Act = 'analisar' | 'aprovar_cobranca' | 'reprovar_cobranca' | 'enviar_financeiro' | 'encaminhar_manutencao' | 'resolver';

export const OcorrenciasView: React.FC = () => {
  const { user, navigate } = useLog();
  const toast = useToast();
  const [status, setStatus] = useState('abertas');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: Occurrence[] }>(`/logistics/occurrences${qs({ status, q: dq })}`), [status, dq]);
  const [sel, setSel] = useState<{ occ: Occurrence; act: Act } | null>(null);
  const [f, setF] = useState({ status: 'em_analise', responsibility: 'indefinida' as Responsibility, estimated_cost: null as number | null, approved_cost: null as number | null, notes: '', due_date: addDaysISO(todayISO(), 10) });
  const [busy, setBusy] = useState(false);
  const costs = logCan.viewCosts(user);
  const open = (occ: Occurrence, act: Act) => (setF({ status: 'em_analise', responsibility: occ.responsibility, estimated_cost: occ.estimated_cost, approved_cost: occ.estimated_cost, notes: '', due_date: addDaysISO(todayISO(), 10) }), setSel({ occ, act }));
  const submit = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await api.post(`/logistics/occurrences/${sel.occ.id}/${sel.act}`, f);
      toast('success', 'Ocorrência atualizada.');
      setSel(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const TITLES: Record<Act, string> = { analisar: 'Análise da ocorrência', aprovar_cobranca: 'Aprovar cobrança', reprovar_cobranca: 'Não passível de cobrança', enviar_financeiro: 'Enviar cobrança ao Financeiro', encaminhar_manutencao: 'Encaminhar para manutenção', resolver: 'Resolver ocorrência' };
  return (
    <div>
      <PageHeader title="Avarias e ocorrências" subtitle="Avarias, perdas e faltas registradas nas operações. A responsabilidade é apurada antes de qualquer cobrança, que só segue para o Financeiro com aprovação." />
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, contrato, cliente, patrimônio" className="pl-9" aria-label="Pesquisar ocorrências" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-56" aria-label="Situação">
            <option value="abertas">Em aberto</option>
            <option value="">Todas</option>
            {(Object.keys(OCCURRENCE_STATUS_LABELS) as OccurrenceStatus[]).map((s) => <option key={s} value={s}>{OCCURRENCE_STATUS_LABELS[s]}</option>)}
          </Select>
        </div>
        {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.rows.length ? <EmptyState title="Nenhuma ocorrência" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1000px]">
              <thead className="bg-slate-50"><tr><Th>Ocorrência</Th><Th>Contrato / operação</Th><Th>Descrição</Th><Th>Responsabilidade</Th>{costs && <Th right>Estimado / aprovado</Th>}<Th>Situação</Th><Th /></tr></thead>
              <tbody>
                {data.rows.map((x) => (
                  <tr key={x.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5"><b>{x.number}</b><p className="text-[11px] text-slate-500">{OCCURRENCE_TYPE_LABELS[x.occurrence_type]} • {formatDateTimeBR(x.created_at)}</p></td>
                    <td className="px-4 py-2.5">{x.contract_number}<p className="text-[11px] text-slate-500">{x.customer_name}</p>{x.order_id && <button className="text-[11px] text-[#1e3a5f] hover:underline" onClick={() => navigate({ page: 'detalhe', id: x.order_id! })}>{x.order_number}</button>}</td>
                    <td className="px-4 py-2.5 max-w-[300px]">{x.asset_tag && <b>{x.asset_tag}: </b>}{x.description}{x.analysis_notes && <p className="text-[11px] text-slate-500">Análise: {x.analysis_notes}</p>}{x.resolution_notes && <p className="text-[11px] text-slate-500">Conclusão: {x.resolution_notes}</p>}{x.work_order_number && <p className="text-[11px] text-violet-700">OS {x.work_order_number}</p>}{x.charge_entry_number && <p className="text-[11px] text-emerald-700">Cobrança {x.charge_entry_number}</p>}</td>
                    <td className="px-4 py-2.5 text-xs">{RESPONSIBILITY_LABELS[x.responsibility]}</td>
                    {costs && <td className="px-4 py-2.5 text-right tabular-nums text-xs">{x.estimated_cost !== null ? formatBRL(x.estimated_cost) : '—'}<br />{x.approved_cost !== null ? <b>{formatBRL(x.approved_cost)}</b> : '—'}</td>}
                    <td className="px-4 py-2.5"><OccPill s={x.status} /></td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {!['resolvida', 'aprovada_cobranca'].includes(x.status) && logCan.occurrence(user) && <Button size="sm" variant="ghost" onClick={() => open(x, 'analisar')}>Analisar</Button>}
                      {x.status === 'aguardando_aprovacao' && logCan.approve(user) && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => open(x, 'aprovar_cobranca')}>Aprovar cobrança</Button>
                          <Button size="sm" variant="ghost" onClick={() => open(x, 'reprovar_cobranca')}>Não cobrar</Button>
                        </>
                      )}
                      {x.status === 'aprovada_cobranca' && !x.charge_entry_number && logCan.forwardFinance(user) && <Button size="sm" variant="ghost" onClick={() => open(x, 'enviar_financeiro')}>Enviar ao Financeiro</Button>}
                      {x.asset_tag && !x.work_order_number && ['registrada', 'em_analise', 'aguardando_orcamento'].includes(x.status) && logCan.occurrence(user) && <Button size="sm" variant="ghost" onClick={() => open(x, 'encaminhar_manutencao')}>Manutenção</Button>}
                      {['aprovada_cobranca', 'nao_cobravel', 'encaminhada_manutencao'].includes(x.status) && logCan.occurrence(user) && <Button size="sm" variant="ghost" onClick={() => open(x, 'resolver')}>Resolver</Button>}
                      {logCan.occurrence(user) && (
                        <label className="inline-flex items-center px-2 py-1 text-xs text-slate-600 cursor-pointer hover:text-slate-900" title="Anexar evidência">
                          <Paperclip className="w-3.5 h-3.5" />
                          <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { await api.post(`/logistics/occurrences/${x.id}/attachments`, { ...(await readFile(file)), phase: 'inspecao', title: file.name }); toast('success', 'Evidência anexada.'); } catch (err) { toast('error', (err as ApiError).message); } }} />
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? TITLES[sel.act] : ''} size="sm" footer={<><Button onClick={() => setSel(null)}>Voltar</Button><Button variant="primary" loading={busy} onClick={submit}>Confirmar</Button></>}>
        {sel && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600"><b>{sel.occ.number}</b> — {sel.occ.description}</p>
            {sel.act === 'analisar' && (
              <>
                <Field label="Responsabilidade apurada">
                  <Select value={f.responsibility} onChange={(e) => setF({ ...f, responsibility: e.target.value as Responsibility })}>
                    {(Object.keys(RESPONSIBILITY_LABELS) as Responsibility[]).map((r) => <option key={r} value={r}>{RESPONSIBILITY_LABELS[r]}</option>)}
                  </Select>
                </Field>
                {costs && <Field label="Estimativa de custo"><MoneyInput value={f.estimated_cost} allowEmpty onChange={(v) => setF({ ...f, estimated_cost: v })} /></Field>}
                <Field label="Próximo passo">
                  <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                    <option value="em_analise">Continuar em análise</option>
                    <option value="aguardando_orcamento">Aguardando orçamento</option>
                    <option value="aguardando_aprovacao">Enviar para aprovação de cobrança (cliente)</option>
                    <option value="nao_cobravel">Não passível de cobrança</option>
                    <option value="resolvida">Resolvida</option>
                  </Select>
                </Field>
              </>
            )}
            {sel.act === 'aprovar_cobranca' && <Field label="Valor aprovado"><MoneyInput value={f.approved_cost} onChange={(v) => setF({ ...f, approved_cost: v })} /></Field>}
            {sel.act === 'enviar_financeiro' && (
              <>
                <p className="text-xs text-slate-500">Lança uma cobrança extraordinária no contrato ({sel.occ.approved_cost !== null ? formatBRL(sel.occ.approved_cost) : ''}), que vira conta a receber no Financeiro. Não duplica se enviado de novo.</p>
                <Field label="Vencimento"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
              </>
            )}
            {sel.act === 'encaminhar_manutencao' && <p className="text-xs text-slate-500">Coloca o equipamento como "em manutenção" no Estoque; depois do conserto, registre o retorno de manutenção no cadastro do equipamento (ele passa pela inspeção antes de voltar a alugar) (bloqueado para locação até a conclusão e a inspeção).</p>}
            {sel.act !== 'enviar_financeiro' && sel.act !== 'encaminhar_manutencao' && <Field label="Observações / conclusão"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>}
          </div>
        )}
      </Modal>
    </div>
  );
};
