/**
 * Relatórios de manutenção com período explícito e exportação CSV (dados reais; previsto ≠ realizado).
 */

import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { osCan } from '../../../../shared/os/rules';
import { formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useOs } from '../context';
import { Th } from '../components';

const NO_PERIOD = ['atrasadas', 'preventivas'];
const MONEY = /^(custo|custo_realizado|previsto|realizado|diferenca)$/;
const HEAD: Record<string, string> = {
  situacao: 'Situação', os: 'OS', patrimonio: 'Patrimônio', equipamento: 'Equipamento', concluidas: 'Concluídas', abertas: 'Abertas', tecnico: 'Técnico', horas: 'Horas', custo: 'Custo',
  tipo: 'Tipo', servico: 'Serviço', prioridade: 'Prioridade', prazo: 'Prazo', dias_atraso: 'Dias de atraso', responsavel: 'Responsável', plano: 'Plano', proxima_data: 'Próxima data',
  proximo_medidor: 'Próximo medidor', medidor_atual: 'Medidor atual', os_aberta: 'OS aberta', categoria: 'Categoria', custo_realizado: 'Custo realizado', mes: 'Mês', previsto: 'Previsto',
  realizado: 'Realizado', codigo: 'Código', descricao: 'Descrição', unidade: 'Un.', quantidade_utilizada: 'Qtd. utilizada', horas_total: 'Horas (abertura→conclusão)',
  horas_execucao: 'Horas em execução', horas_espera: 'Horas aguardando', bloqueios: 'Bloqueios', horas_indisponivel: 'Horas indisponível', diferenca: 'Diferença', defeito: 'Defeito',
  ocorrencias: 'Ocorrências', primeira: 'Primeira', ultima: 'Última', ordens: 'Ordens',
};

export const OsReportsView: React.FC = () => {
  const { reports, user } = useOs();
  const toast = useToast();
  const today = todayISO();
  const [kind, setKind] = useState(Object.keys(reports)[0]);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>(`/os/reports/${kind}${qs({ from, to })}`), [kind, from, to]);
  const rows = data?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const usesPeriod = !NO_PERIOD.includes(kind);
  const fmt = (k: string, v: any) => (v === null || v === undefined ? '—' : MONEY.test(k) && typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateBR(v) : typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v));
  return (
    <div>
      <PageHeader title="Relatórios de manutenção" subtitle="Custos realizados vêm do que foi efetivamente utilizado/executado; previstos aparecem separados." actions={osCan.export(user) && <Button icon={FileSpreadsheet} onClick={async () => { try { saveBlob(await fetchBlob(`/os/reports/${kind}${qs({ from, to, format: 'csv' })}`), `os-${kind}-${today}.csv`); } catch (e) { toast('error', (e as Error).message); } }}>Exportar CSV</Button>} />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Relatório" className="w-full sm:w-80">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(reports).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        {usesPeriod && (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </>
        )}
      </div>
      <Card title={usesPeriod ? `Período: ${formatDateBR(from)} a ${formatDateBR(to)}` : `Posição em ${formatDateBR(today)}`} bodyClassName="p-0">
        {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !rows.length ? <p className="text-sm text-slate-500 text-center py-10">Sem registros.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr>{cols.map((k) => <Th key={k} right={MONEY.test(k)}>{HEAD[k] || k}</Th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">{cols.map((k) => <td key={k} className={cx('px-4 py-2', MONEY.test(k) && 'text-right tabular-nums')}>{fmt(k, r[k])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
