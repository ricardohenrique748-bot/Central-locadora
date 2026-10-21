/**
 * Inadimplência: clientes com recebíveis vencidos, por faixa de atraso.
 */

import React from 'react';
import { Phone, Mail } from 'lucide-react';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { formatPhone } from '../../../../shared/orcamentos/validators';
import { api } from '../../orcamentos/api';
import { Card, EmptyState, ErrorState, Loading, PageHeader, useAsync } from '../../orcamentos/ui';
import { useFin } from '../context';
import { Th } from '../components';

export const DelinquencyView: React.FC = () => {
  const { navigate } = useFin();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>('/finance/delinquency'), []);
  const rows = data?.rows || [];
  const sum = (k: string) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return (
    <div>
      <PageHeader title="Inadimplência" subtitle="Saldo pendente de parcelas a receber vencidas (até hoje), agrupado por cliente." />
      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          {[
            ['Total vencido', 'total'],
            ['Até 30 dias', 'd30'],
            ['31 a 60 dias', 'd60'],
            ['61 a 90 dias', 'd90'],
            ['Acima de 90 dias', 'd90p'],
          ].map(([l, k]) => (
            <div key={k} className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs text-slate-500">{l}</p>
              <p className="text-lg font-extrabold tabular-nums text-red-700">{formatBRL(sum(k))}</p>
            </div>
          ))}
        </div>
      )}
      <Card bodyClassName="p-0">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !rows.length ? (
          <EmptyState title="Nenhum cliente inadimplente" text="Não há parcelas a receber vencidas em aberto." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Cliente</Th>
                  <Th>Mais antigo</Th>
                  <Th right>Parcelas</Th>
                  <Th right>Até 30</Th>
                  <Th right>31–60</Th>
                  <Th right>61–90</Th>
                  <Th right>+90</Th>
                  <Th right>Total</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.customer_id}-${r.party_name}`} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'receber', status: 'vencido' })}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold">{r.party_name}</p>
                      {r.contact && (
                        <p className="text-[11px] text-slate-500 flex flex-wrap gap-2">
                          {(r.contact.whatsapp || r.contact.phone) && (
                            <span className="inline-flex items-center gap-0.5">
                              <Phone className="w-3 h-3" />
                              {formatPhone(r.contact.whatsapp || r.contact.phone)}
                            </span>
                          )}
                          {r.contact.email && (
                            <span className="inline-flex items-center gap-0.5">
                              <Mail className="w-3 h-3" />
                              {r.contact.email}
                            </span>
                          )}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {formatDateBR(r.oldest)}
                      <span className="block text-[11px] text-red-700">{r.days} dia(s)</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.parcelas}</td>
                    {['d30', 'd60', 'd90', 'd90p'].map((k) => (
                      <td key={k} className="px-4 py-2.5 text-right tabular-nums">
                        {r[k] ? formatBRL(r[k]) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums font-bold text-red-700">{formatBRL(r.total)}</td>
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
