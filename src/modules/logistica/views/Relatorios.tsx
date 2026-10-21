/**
 * Relatórios de entregas e devoluções com filtros e exportação CSV (estimado ≠ realizado).
 */

import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { logCan } from '../../../../shared/logistica/rules';
import { formatDateBR, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useLog } from '../context';
import { Th } from '../components';

const NO_PERIOD = ['pendentes', 'devolucoes_atrasadas', 'com_clientes', 'aguardando_inspecao'];
const MONEY = /^(estimado|realizado)$/;
const HEAD: Record<string, string> = {
  operacao: 'Operação', tipo: 'Tipo', contrato: 'Contrato', cliente: 'Cliente', programada: 'Programada', realizada: 'Realizada', situacao: 'Situação', quantidade: 'Qtd.', dia: 'Dia', entregas: 'Entregas',
  no_prazo: 'No prazo', atrasadas: 'Atrasadas', codigo: 'Código', descricao: 'Descrição', patrimonio: 'Patrimônio', prevista: 'Prevista', dias_atraso: 'Dias de atraso', devolucao_prevista: 'Devolução prevista',
  recebida: 'Recebida', equipamento: 'Equipamento', ocorrencias: 'Ocorrências', aprovadas_cobranca: 'Aprovadas p/ cobrança', nao_cobraveis: 'Não cobráveis', abertas: 'Abertas', enviadas_financeiro: 'Enviadas ao Financeiro',
  transporte: 'Transporte', estimado: 'Estimado', realizado: 'Realizado', conta_pagar: 'Conta a pagar', inspecionada: 'Inspecionada', resultado: 'Resultado', horas: 'Horas', data: 'Data', programado: 'Programado', faltante: 'Faltante', justificativa: 'Justificativa',
};

export const LogReportsView: React.FC = () => {
  const { reports, user, users } = useLog();
  const toast = useToast();
  const today = todayISO();
  const [kind, setKind] = useState(Object.keys(reports)[0]);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [resp, setResp] = useState('');
  const params = { from, to, responsible_id: resp };
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>(`/logistics/reports/${kind}${qs(params)}`), [kind, from, to, resp]);
  const rows = data?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]).filter((k) => rows.some((r) => r[k] !== undefined)) : [];
  const fmt = (k: string, v: any) => (v === null || v === undefined ? '—' : MONEY.test(k) && typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? formatDateTimeBR(v) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateBR(v) : String(v));
  const usesPeriod = !NO_PERIOD.includes(kind);
  return (
    <div>
      <PageHeader title="Relatórios de entregas e devoluções" subtitle="Dados reais das operações, do Estoque e das inspeções." actions={logCan.export(user) && <Button icon={FileSpreadsheet} onClick={async () => { try { saveBlob(await fetchBlob(`/logistics/reports/${kind}${qs({ ...params, format: 'csv' })}`), `logistica-${kind}-${today}.csv`); } catch (e) { toast('error', (e as Error).message); } }}>Exportar CSV</Button>} />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Relatório" className="w-full sm:w-80"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(reports).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {usesPeriod && (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Responsável" className="w-full sm:w-44"><Select value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Todos</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          </>
        )}
      </div>
      <Card title={usesPeriod ? `Período: ${formatDateBR(from)} a ${formatDateBR(to)}` : `Posição em ${formatDateBR(today)}`} bodyClassName="p-0">
        {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !rows.length ? <p className="text-sm text-slate-500 text-center py-10">Sem registros.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr>{cols.map((k) => <Th key={k} right={MONEY.test(k)}>{HEAD[k] || k}</Th>)}</tr></thead>
              <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i} className="border-t border-slate-100">{cols.map((k) => <td key={k} className={cx('px-4 py-2', MONEY.test(k) && 'text-right tabular-nums')}>{fmt(k, r[k])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
