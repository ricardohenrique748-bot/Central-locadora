/**
 * Central de notificações: minhas notificações (filtros, leitura, link), configurações de alertas
 * (empresa: administrador; preferências pessoais: todos) e processamento (log e execução manual).
 */

import React, { useEffect, useState } from 'react';
import { CheckCheck, ExternalLink, RefreshCw, Save, Search, Circle, CircleCheck } from 'lucide-react';
import { AuthUser, ROLE_LABELS, Role } from '../../../shared/orcamentos/types';
import { CATEGORY_LABELS, Category, EventDef, EventSetting, NotificationItem, NotificationLink, PRIORITY_LABELS, Priority, ProcessingLog } from '../../../shared/notificacoes/types';
import { formatDateTimeBR } from '../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, Pagination, Select, ToastProvider, cx, useAsync, useDebounced, useToast } from '../orcamentos/ui';

const PRIO_STYLE: Record<Priority, string> = { critica: 'bg-red-100 text-red-700', alta: 'bg-orange-100 text-orange-800', media: 'bg-sky-100 text-sky-800', baixa: 'bg-slate-100 text-slate-600' };
/** Manutenção (OS) não é usada pela locadora: a categoria fica fora da central. */
const VISIBLE_CATEGORIES = (Object.keys(CATEGORY_LABELS) as Category[]).filter((c) => c !== 'manutencao');
const ROLES: Role[] = ['admin', 'gestor', 'vendedor', 'estoquista', 'financeiro', 'tecnico', 'consulta'];

const Lista: React.FC<{ onOpenLink: (l: NotificationLink) => void }> = ({ onOpenLink }) => {
  const toast = useToast();
  const [f, setF] = useState({ status: 'unread', category: '', priority: '', q: '', resolved: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(f.q, 300);
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; page_size: number; rows: NotificationItem[]; unread_by_category: { category: Category; n: number }[] }>(`/notification-center${qs({ ...f, q: dq, page })}`),
    [f.status, f.category, f.priority, dq, f.resolved, page]
  );
  const set = (k: keyof typeof f, v: string) => (setF({ ...f, [k]: v }), setPage(1));
  const toggle = async (n: NotificationItem) => {
    try {
      await api.post(`/notification-center/${n.id}/${n.read_at ? 'unread' : 'read'}`);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  };
  const open = async (n: NotificationItem) => {
    if (!n.read_at) await api.post(`/notification-center/${n.id}/read`).catch(() => undefined);
    if (n.link) onOpenLink(n.link);
  };
  const unreadTotal = data?.unread_by_category.reduce((a, c) => a + c.n, 0) || 0;
  return (
    <Card bodyClassName="p-0">
      <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2 items-center">
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Buscar no título ou descrição" className="pl-9" aria-label="Buscar notificações" />
        </div>
        <Select value={f.status} onChange={(e) => set('status', e.target.value)} className="w-full sm:w-40" aria-label="Leitura">
          <option value="unread">Não lidas</option>
          <option value="read">Lidas</option>
          <option value="">Todas</option>
        </Select>
        <Select value={f.category} onChange={(e) => set('category', e.target.value)} className="w-full sm:w-52" aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {VISIBLE_CATEGORIES.map((c) => {
            const n = data?.unread_by_category.find((x) => x.category === c)?.n;
            return <option key={c} value={c}>{CATEGORY_LABELS[c]}{n ? ` (${n})` : ''}</option>;
          })}
        </Select>
        <Select value={f.priority} onChange={(e) => set('priority', e.target.value)} className="w-full sm:w-36" aria-label="Prioridade">
          <option value="">Prioridades</option>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </Select>
        <Select value={f.resolved} onChange={(e) => set('resolved', e.target.value)} className="w-full sm:w-52" aria-label="Situação do evento">
          <option value="">Pendências atuais</option>
          <option value="only">Já resolvidas (histórico)</option>
          <option value="include">Atuais e resolvidas</option>
        </Select>
        {unreadTotal > 0 && (
          <Button size="sm" icon={CheckCheck} className="sm:ml-auto" onClick={async () => { await api.post('/notification-center/read-all', { category: f.category || undefined }); toast('success', 'Notificações marcadas como lidas.'); reload(); }}>
            Marcar {f.category ? 'categoria' : 'todas'} como lidas
          </Button>
        )}
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data?.rows.length ? (
        <EmptyState title={f.status === 'unread' ? 'Nenhuma notificação não lida' : 'Nenhuma notificação'} text="Os alertas são gerados automaticamente a partir dos contratos, financeiro, estoque, OS, entregas e orçamentos." />
      ) : (
        <>
          <ul>
            {data.rows.map((n) => (
              <li key={n.id} className={cx('border-t border-slate-100 first:border-0 px-4 py-3 flex gap-3 items-start', !n.read_at && !n.resolved_at && 'bg-sky-50/40')}>
                <button onClick={() => toggle(n)} className="mt-0.5 text-slate-400 hover:text-slate-700" aria-label={n.read_at ? 'Marcar como não lida' : 'Marcar como lida'} title={n.read_at ? 'Marcar como não lida' : 'Marcar como lida'}>
                  {n.read_at ? <CircleCheck className="w-4 h-4" /> : <Circle className="w-4 h-4 text-[#2AA3D8]" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx('text-sm', n.read_at ? 'font-medium text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                    <span className={cx('px-1.5 py-0.5 rounded text-[10px] font-semibold', PRIO_STYLE[n.priority])}>{PRIORITY_LABELS[n.priority]}</span>
                    {n.resolved_at && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700">Resolvida {formatDateTimeBR(n.resolved_at)}</span>}
                  </div>
                  <p className="text-sm text-slate-600">{n.message}</p>
                  <p className="text-[11px] text-slate-400">{CATEGORY_LABELS[n.category]} • {formatDateTimeBR(n.created_at)}</p>
                </div>
                {n.link && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => open(n)}>Abrir</Button>}
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
};

const Config: React.FC<{ user: AuthUser }> = ({ user }) => {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ events: EventDef[]; settings: EventSetting[]; global: { interval_minutes: number; retention_days: number }; last_run: ProcessingLog | null; can_edit: boolean; channels: { key: string; label: string; configured: boolean; note?: string }[] }>('/notification-center/settings'),
    []
  );
  const prefs = useAsync(() => api.get<{ muted: string[] }>('/notification-center/prefs'), []);
  const [rows, setRows] = useState<Record<string, EventSetting & { leadsText: string }>>({});
  const [global, setGlobal] = useState({ interval_minutes: 15, retention_days: 90 });
  const [muted, setMuted] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setRows(Object.fromEntries(data.settings.map((s) => [s.event_type, { ...s, leadsText: (s.leads || []).join(', ') }])));
    setGlobal(data.global);
  }, [data]);
  useEffect(() => setMuted(prefs.data?.muted || []), [prefs.data]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error || 'Erro'} onRetry={reload} />;
  const edit = data.can_edit;
  const upd = (t: string, p: Partial<EventSetting & { leadsText: string }>) => setRows({ ...rows, [t]: { ...rows[t], ...p } });
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/notification-center/settings', { global, events: Object.values(rows).map((r) => ({ ...r, leads: r.leadsText })) });
      toast('success', 'Configurações salvas. Valem a partir do próximo processamento.');
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Card title="Minhas preferências">
        <p className="text-sm text-slate-600 mb-2">Silenciar categorias para você. Alertas críticos (contas vencidas, devoluções atrasadas, falhas) continuam chegando.</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {VISIBLE_CATEGORIES.filter((c) => c !== 'sistema').map((c) => (
            <Checkbox key={c} checked={muted.includes(c)} onChange={(v) => setMuted(v ? [...muted, c] : muted.filter((x) => x !== c))} label={`Silenciar ${CATEGORY_LABELS[c].toLowerCase()}`} />
          ))}
        </div>
        <div className="flex justify-end mt-3">
          <Button size="sm" icon={Save} onClick={async () => { await api.put('/notification-center/prefs', { muted }); toast('success', 'Preferências salvas.'); }}>Salvar preferências</Button>
        </div>
      </Card>
      <Card title="Canais">
        <ul className="text-sm space-y-1">
          {data.channels.map((c) => (
            <li key={c.key} className="flex justify-between gap-2">
              <span>{c.label}</span>
              <span className={c.configured ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>{c.configured ? 'Ativo' : `Não configurado — ${c.note}`}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500 mt-2">Sem provedor externo configurado, as notificações são criadas apenas na central do sistema. Nenhum envio é simulado.</p>
      </Card>
      <Card title="Alertas da empresa" actions={edit && <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={save}>Salvar</Button>}>
        {!edit && <Notice className="mb-3">Somente o administrador altera os alertas da empresa.</Notice>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mb-4">
          <Field label="Frequência da verificação automática (minutos)"><Input type="number" min={5} max={1440} disabled={!edit} value={global.interval_minutes} onChange={(e) => setGlobal({ ...global, interval_minutes: Number(e.target.value) })} /></Field>
          <Field label="Retenção do histórico (dias)"><Input type="number" min={7} max={730} disabled={!edit} value={global.retention_days} onChange={(e) => setGlobal({ ...global, retention_days: Number(e.target.value) })} /></Field>
        </div>
        {VISIBLE_CATEGORIES.map((cat) => (
          <div key={cat} className="mb-5">
            <p className="text-xs font-bold uppercase text-slate-500 mb-1">{CATEGORY_LABELS[cat]}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <tbody>
                  {data.events.filter((e) => e.category === cat).map((e) => {
                    const r = rows[e.type];
                    if (!r) return null;
                    return (
                      <tr key={e.type} className="border-t border-slate-100 align-top">
                        <td className="py-2 pr-3 w-[34%]">
                          <Checkbox checked={r.enabled} disabled={!edit || e.critical} onChange={(v) => upd(e.type, { enabled: v })} label={<span className="font-semibold">{e.label}{e.critical && <span className="ml-1 text-[10px] text-red-600 uppercase">crítico</span>}</span>} />
                          <p className="text-xs text-slate-500 ml-6">{e.description}</p>
                        </td>
                        <td className="py-2 pr-3 w-[16%]">
                          {e.leads && <Field label="Antecedência (dias)"><Input disabled={!edit} value={r.leadsText} onChange={(ev) => upd(e.type, { leadsText: ev.target.value })} placeholder="7, 3, 1" /></Field>}
                          {e.inactivity !== undefined && <Field label="Após (dias)"><Input type="number" min={0} disabled={!edit} value={r.inactivity_days ?? 0} onChange={(ev) => upd(e.type, { inactivity_days: Number(ev.target.value) })} /></Field>}
                        </td>
                        <td className="py-2">
                          <p className="text-[11px] text-slate-500 mb-1">Perfis que recebem</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {ROLES.map((ro) => <Checkbox key={ro} checked={r.roles.includes(ro)} disabled={!edit} onChange={(v) => upd(e.type, { roles: v ? [...r.roles, ro] : r.roles.filter((x) => x !== ro) })} label={<span className="text-xs">{ROLE_LABELS[ro]}</span>} />)}
                          </div>
                          <Checkbox checked={r.notify_responsible} disabled={!edit} onChange={(v) => upd(e.type, { notify_responsible: v })} label={<span className="text-xs">Avisar também o responsável pelo registro</span>} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="text-xs text-slate-500">Mesmo marcado, um perfil só recebe o que pode ver: alertas financeiros só chegam a quem acessa o Financeiro, e vendedores só recebem o que é deles.</p>
      </Card>
    </div>
  );
};

const Processamento: React.FC<{ user: AuthUser }> = ({ user }) => {
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: (ProcessingLog & { triggered_by_name: string | null })[] }>('/notification-center/logs'), []);
  const [busy, setBusy] = useState(false);
  if (user.role !== 'admin') return <Notice>Somente o administrador consulta o processamento.</Notice>;
  const TRIG: Record<string, string> = { agendado: 'Agendado', manual: 'Manual', evento: 'Após operação', inicializacao: 'Início do servidor' };
  return (
    <Card title="Processamento automático" bodyClassName="p-0" actions={<Button size="sm" icon={RefreshCw} loading={busy} onClick={async () => { setBusy(true); try { const r = await api.post<any>('/notification-center/process'); toast(r.status === 'sucesso' ? 'success' : 'error', r.status === 'ignorado' ? 'Já havia um processamento em andamento.' : `Processamento ${r.status}: ${r.created} nova(s), ${r.resolved} resolvida(s).`); reload(); } finally { setBusy(false); } }}>Processar agora</Button>}>
      <p className="text-xs text-slate-500 px-4 pt-3">A verificação roda no servidor de forma recorrente (frequência configurável), ao iniciar o sistema e logo após operações gravadas nos módulos. Não depende de alguém abrir a tela.</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px] mt-2">
            <thead className="bg-slate-50"><tr>{['Início', 'Origem', 'Situação', 'Novas', 'Entregas', 'Resolvidas', 'Erros'].map((h) => <th key={h} className="text-left px-4 py-2 text-xs uppercase text-slate-500 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {data?.rows.map((l) => (
                <tr key={l.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{formatDateTimeBR(l.started_at)}</td>
                  <td className="px-4 py-2">{TRIG[l.trigger] || l.trigger}{l.triggered_by_name ? ` (${l.triggered_by_name})` : ''}</td>
                  <td className="px-4 py-2"><span className={cx('px-1.5 py-0.5 rounded text-[11px] font-semibold', l.status === 'sucesso' ? 'bg-emerald-100 text-emerald-800' : l.status === 'executando' ? 'bg-sky-100 text-sky-800' : 'bg-red-100 text-red-700')}>{l.status}</span></td>
                  <td className="px-4 py-2">{l.created_count}</td>
                  <td className="px-4 py-2">{l.delivered_count}</td>
                  <td className="px-4 py-2">{l.resolved_count}</td>
                  <td className="px-4 py-2 text-xs text-red-700 max-w-[320px]">{l.error_summary || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export const NotificacoesModule: React.FC<{ user: AuthUser; onOpenLink: (l: NotificationLink) => void; initialTab?: 'lista' | 'config' | 'processamento' }> = ({ user, onOpenLink, initialTab }) => {
  const [tab, setTab] = useState<'lista' | 'config' | 'processamento'>(initialTab || 'lista');
  useEffect(() => setTab(initialTab || 'lista'), [initialTab]);
  return (
    <ToastProvider>
      <PageHeader title="Notificações" subtitle="Avisos gerados automaticamente a partir dos dados reais de cada módulo, conforme o seu perfil." />
      <div className="flex gap-1 border-b border-slate-200 mb-4" role="tablist">
        {([['lista', 'Minhas notificações'], ['config', 'Configurações'], ...(user.role === 'admin' ? [['processamento', 'Processamento']] : [])] as [string, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k as any)} className={cx('px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px', tab === k ? 'border-[#1e3a5f] text-[#1e3a5f]' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'lista' && <Lista onOpenLink={onOpenLink} />}
      {tab === 'config' && <Config user={user} />}
      {tab === 'processamento' && <Processamento user={user} />}
    </ToastProvider>
  );
};
