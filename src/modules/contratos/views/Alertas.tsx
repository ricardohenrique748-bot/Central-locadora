/**
 * Central de alertas: vencimentos, devoluções, cobranças, aprovações, assinaturas e avarias.
 */

import React, { useState } from 'react';
import { ContractAlert } from '../../../../shared/contratos/types';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { api, qs } from '../../orcamentos/api';
import { Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync } from '../../orcamentos/ui';
import { useCtr } from '../context';
import { Th } from '../components';

const KINDS: Record<string, string> = {
  vencendo: 'Próximos do vencimento',
  vencido_com_equipamento: 'Vencidos com equipamento no cliente',
  renovacao: 'Renovações pendentes',
  entrega: 'Entregas programadas',
  devolucao: 'Devoluções programadas',
  devolucao_atrasada: 'Devoluções atrasadas',
  cobranca_vencida: 'Cobranças vencidas',
  aprovacao: 'Aguardando aprovação',
  assinatura: 'Aguardando assinatura',
  avaria: 'Devoluções com avaria',
};
const PRIO = { alta: 'bg-red-100 text-red-700', media: 'bg-amber-100 text-amber-800', baixa: 'bg-slate-100 text-slate-600' };

export const AlertasView: React.FC = () => {
  const { users, navigate, settings } = useCtr();
  const [f, setF] = useState({ priority: '', kind: '', responsible_id: '', until: '' });
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: ContractAlert[] }>(`/contracts/alerts${qs(f)}`), [f.priority, f.kind, f.responsible_id, f.until]);
  return (
    <div>
      <PageHeader title="Alertas de contratos" subtitle={`Prazos de aviso de vencimento: ${settings.alert_days.join(', ')} dias (ajustável em Configurações).`} />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Prioridade" className="w-full sm:w-36">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="">Todas</option>
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </Select>
        </Field>
        <Field label="Tipo" className="w-full sm:w-64">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsável" className="w-full sm:w-48">
          <Select value={f.responsible_id} onChange={(e) => setF({ ...f, responsible_id: e.target.value })}>
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Com data até" className="w-full sm:w-40">
          <Input type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} />
        </Field>
      </div>
      <Card bodyClassName="p-0">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum alerta" text="Nada exige atenção com os filtros atuais." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Prioridade</Th>
                  <Th>Alerta</Th>
                  <Th>Contrato</Th>
                  <Th>Data</Th>
                  <Th>Responsável</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((a, i) => (
                  <tr key={`${a.kind}-${a.contract_id}-${i}`} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'detalhe', id: a.contract_id })}>
                    <td className="px-4 py-2.5">
                      <span className={cx('px-2 py-0.5 rounded-full text-[11px] font-semibold', PRIO[a.priority])}>{a.priority === 'media' ? 'média' : a.priority}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold">{a.label}</p>
                      <p className="text-xs text-slate-500">{a.text}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#1e3a5f]">{a.contract_number}</p>
                      <p className="text-xs text-slate-500">{a.customer_name}</p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDateBR(a.date)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{a.responsible_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
