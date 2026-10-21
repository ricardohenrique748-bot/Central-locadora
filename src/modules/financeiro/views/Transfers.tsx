/**
 * Transferências entre contas próprias (não são receita nem despesa).
 */

import React, { useState } from 'react';
import { Plus, ArrowRight, CheckCircle2, Ban, Undo2 } from 'lucide-react';
import { Transfer } from '../../../../shared/financeiro/types';
import { financeCan } from '../../../../shared/financeiro/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Select, Textarea, useAsync, useToast } from '../../orcamentos/ui';
import { newIdempotencyKey, useFin } from '../context';
import { AccountSelect, Th, TransferPill } from '../components';

export const TransfersView: React.FC = () => {
  const { user, reload: reloadCtx } = useFin();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: Transfer[] }>(`/finance/transfers${qs({ status })}`), [status]);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState<Transfer | null>(null);
  const [reason, setReason] = useState('');

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      reload();
      reloadCtx();
      return true;
    } catch (e) {
      toast('error', (e as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Transferências"
        subtitle="Saída da origem e entrada no destino gravadas juntas. Não contam como receita ou despesa."
        actions={
          financeCan.operate(user) && (
            <Button variant="primary" icon={Plus} onClick={() => setForm({ source_account_id: null, destination_account_id: null, amount: 0, transfer_date: todayISO(), description: '', reference: '', pending: false, key: newIdempotencyKey() })}>
              Nova transferência
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56" aria-label="Situação">
            <option value="">Todas</option>
            <option value="pendente">Pendentes de efetivação</option>
            <option value="efetivada">Efetivadas</option>
            <option value="estornada">Estornadas</option>
            <option value="cancelada">Canceladas</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhuma transferência" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Nº / data</Th>
                  <Th>Origem → destino</Th>
                  <Th right>Valor</Th>
                  <Th>Referência</Th>
                  <Th>Situação</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold">{t.number}</p>
                      <p className="text-[11px] text-slate-500">
                        {formatDateBR(t.transfer_date)} • {t.performed_by_name}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      {t.source_name} <ArrowRight className="inline w-3.5 h-3.5 text-slate-400" /> {t.destination_name}
                      {t.description && <p className="text-[11px] text-slate-500">{t.description}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatBRL(t.amount)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{t.reference || '—'}</td>
                    <td className="px-4 py-2.5">
                      <TransferPill s={t.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {t.status === 'pendente' && financeCan.operate(user) && (
                        <>
                          <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy} onClick={() => act(() => api.post(`/finance/transfers/${t.id}/efetivar`), 'Transferência efetivada.')}>
                            Efetivar
                          </Button>{' '}
                          <Button size="sm" icon={Ban} onClick={() => act(() => api.post(`/finance/transfers/${t.id}/cancelar`), 'Transferência cancelada.')}>
                            Cancelar
                          </Button>
                        </>
                      )}
                      {t.status === 'efetivada' && financeCan.reverse(user) && (
                        <Button size="sm" icon={Undo2} className="text-red-700" onClick={() => (setRev(t), setReason(''))}>
                          Estornar
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

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Nova transferência"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                const ok = await act(
                  () => api.post('/finance/transfers', { ...form, status: form.pending ? 'pendente' : 'efetivada', idempotency_key: form.key }),
                  form.pending ? 'Transferência registrada como pendente.' : 'Transferência efetivada.'
                );
                if (ok) setForm(null);
              }}
            >
              Transferir
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Conta de origem" required>
              <AccountSelect value={form.source_account_id} onChange={(v) => setForm({ ...form, source_account_id: v })} />
            </Field>
            <Field label="Conta de destino" required>
              <AccountSelect value={form.destination_account_id} onChange={(v) => setForm({ ...form, destination_account_id: v })} />
            </Field>
            <Field label="Valor" required>
              <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v ?? 0 })} />
            </Field>
            <Field label="Data">
              <Input type="date" value={form.transfer_date} onChange={(e) => setForm({ ...form, transfer_date: e.target.value })} />
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Documento de referência" className="sm:col-span-2">
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Comprovante, TED, depósito..." />
            </Field>
            <div className="sm:col-span-2">
              <Checkbox checked={form.pending || form.transfer_date > todayISO()} onChange={(v) => setForm({ ...form, pending: v })} label="Registrar como pendente (efetivar quando a outra conta confirmar)" />
              {form.source_account_id && form.source_account_id === form.destination_account_id && <Notice kind="danger" className="mt-2">Origem e destino devem ser diferentes.</Notice>}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!rev}
        onClose={() => setRev(null)}
        title={`Estornar ${rev?.number}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setRev(null)}>Voltar</Button>
            <Button variant="danger" disabled={!reason.trim()} loading={busy} onClick={async () => (await act(() => api.post(`/finance/transfers/${rev!.id}/estornar`, { reason }), 'Transferência estornada.')) && setRev(null)}>
              Estornar
            </Button>
          </>
        }
      >
        <Notice className="mb-3">Devolve o valor à origem e retira do destino, com movimentações vinculadas às originais.</Notice>
        <Field label="Motivo" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
};
