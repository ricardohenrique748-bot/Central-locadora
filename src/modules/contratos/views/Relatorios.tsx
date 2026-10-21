/**
 * Relatórios de contratos com período explícito e exportação CSV.
 * Valores contratados, previstos e recebidos aparecem sempre separados.
 */

import React, { useState } from 'react';
import { FileSpreadsheet, Info } from 'lucide-react';
import { contractCan } from '../../../../shared/contratos/rules';
import { formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useCtr } from '../context';
import { Th } from '../components';

const PERIOD = ['ativos_periodo', 'encerrados_cancelados', 'valor_contratado', 'renovacoes', 'avarias'];
const MONEY = /^(valor|valor_periodo|mensal_equivalente|valor_contratado|recebido|pendente|valor_anterior|novo_valor)$/;
const HEAD: Record<string, string> = {
  numero: 'Contrato', cliente: 'Cliente', tipo: 'Tipo', status: 'Status', inicio: 'Início', termino: 'Término', valor_periodo: 'Valor/período', mensal_equivalente: 'Mensal equiv.',
  contratos: 'Contratos', vigentes: 'Vigentes', encerrados: 'Encerrados', valor_contratado: 'Valor contratado', responsavel: 'Responsável', unidades_com_cliente: 'Com o cliente',
  data: 'Data', motivo: 'Motivo', mes: 'Mês', prazo_indeterminado: 'Indeterminados', periodicidade: 'Periodicidade', cobranca: 'Cobrança', titulo: 'Título', vencimento: 'Vencimento',
  valor: 'Valor', recebido: 'Recebido', pendente: 'Pendente', situacao: 'Situação', codigo: 'Código', descricao: 'Descrição', patrimonio: 'Patrimônio', quantidade: 'Qtd.',
  devolucao_prevista: 'Devolução prevista', dias_atraso: 'Dias de atraso', aditivo: 'Aditivo', tipo_aditivo: 'Tipo', termino_anterior: 'Término anterior', novo_termino: 'Novo término',
  valor_anterior: 'Valor anterior', novo_valor: 'Novo valor', justificativa: 'Justificativa', registrado_por: 'Registrado por', devolucao: 'Devolução', avariadas: 'Avariadas',
  manutencao: 'Manutenção', faltantes: 'Faltantes',
};

export const CtrReportsView: React.FC = () => {
  const { reports, user } = useCtr();
  const toast = useToast();
  const today = todayISO();
  const [kind, setKind] = useState(Object.keys(reports)[0]);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const usesPeriod = PERIOD.includes(kind);
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>(`/contracts/reports/${kind}${qs({ from, to })}`), [kind, from, to]);
  const rows = data?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const fmt = (k: string, v: any) => {
    if (v === null || v === undefined) return '—';
    if (MONEY.test(k) && typeof v === 'number') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDateBR(v);
    return String(v);
  };
  return (
    <div>
      <PageHeader
        title="Relatórios de contratos"
        subtitle="Valor contratado não é receita recebida: o recebido vem do Financeiro."
        actions={
          contractCan.export(user) && (
            <Button
              icon={FileSpreadsheet}
              onClick={async () => {
                try {
                  saveBlob(await fetchBlob(`/contracts/reports/${kind}${qs({ from, to, format: 'csv' })}`), `contratos-${kind}-${today}.csv`);
                } catch (e) {
                  toast('error', (e as Error).message);
                }
              }}
            >
              Exportar CSV
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Relatório" className="w-full sm:w-80">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(reports).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {usesPeriod && (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
      </div>
      <Card title={usesPeriod ? `Período: ${formatDateBR(from)} a ${formatDateBR(to)}` : `Posição em ${formatDateBR(today)}`} bodyClassName="p-0">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !rows.length ? (
          <p className="text-sm text-slate-500 text-center py-10">Sem registros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {cols.map((k) => (
                    <Th key={k} right={MONEY.test(k)}>
                      {HEAD[k] || k}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {cols.map((k) => (
                      <td key={k} className={cx('px-4 py-2', MONEY.test(k) && 'text-right tabular-nums')}>
                        {fmt(k, r[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {kind === 'receita_recorrente' && (
        <p className="flex gap-1.5 text-xs text-slate-500 mt-3">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> Receita prevista pelas condições dos contratos vigentes, convertida para o equivalente mensal. Não considera inadimplência.
        </p>
      )}
    </div>
  );
};
