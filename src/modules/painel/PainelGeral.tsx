/**
 * Painel geral: agenda do dia, alertas críticos, indicadores por módulo e ocupação da frota.
 * Tudo vem de /api/home (dados reais do banco, filtrados pelo perfil do usuário).
 */

import React, { useState } from 'react';
import {
  AlertOctagon, ArrowRight, Boxes, CalendarClock, Eye, EyeOff, FilePlus2, FileSignature, FileText, Landmark, PackageCheck, RefreshCw, Truck,
} from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { formatBRL } from '../../../shared/orcamentos/money';
import { formatDateTimeBR } from '../../../shared/orcamentos/dates';
import { NotificationLink } from '../../../shared/notificacoes/types';
import { api } from '../orcamentos/api';
import { Button, Card, ErrorState, Loading, cx, useAsync } from '../orcamentos/ui';

type Link = { module: string; page: string; id?: number };
type Home = {
  today: string;
  contratos: { ativos: number; vencendo: number; vencidos: number; em_elaboracao: number; aguardando_assinatura: number; valor_mensal_ativo: number | null; alert_horizon_days: number } | null;
  financeiro: { saldo_atual: number; a_receber_aberto: number; a_pagar_aberto: number; vencido_receber: number; vencido_pagar: number; receber_hoje: { n: number; v: number }; pagar_hoje: { n: number; v: number } } | null;
  estoque: null | { abaixo_minimo: number; sem_saldo: number; eq_disponiveis: number; eq_alugados: number; eq_reservados: number; eq_manutencao: number; eq_inspecao: number; eq_danificados: number };
  ocupacao: null | { percentual: number | null; itens: { id: number; internal_code: string; description: string; tracking: string; em_uso: number; total: number; percentual: number }[] };
  logistica: null | { entregas_hoje: number; entregas_pendentes: number; entregas_andamento: number; retiradas_programadas: number; devolucoes_hoje: number; devolucoes_atrasadas: number; aguardando_conferencia: number; avarias: number };
  orcamentos: null | { elaboracao: number; aguardando: number; aguardando_aprovacao_interna: number; aprovados: number; taxa_conversao: number | null; valor_aprovado: number | null };
  agenda: { kind: string; label: string; time: string | null; ref: string; text: string; late: boolean; link: Link }[];
  alertas: { id: number; title: string; message: string; priority: 'critica' | 'alta'; link: NotificationLink | null; created_at: string }[];
  acoes: { novo_orcamento: boolean; novo_contrato: boolean; nova_entrega: boolean; estoque: boolean };
};
export type PainelAction = 'novo_orcamento' | 'novo_contrato' | 'nova_entrega' | 'nova_retirada' | 'disponibilidade' | 'notificacoes';

const AGENDA_STYLE: Record<string, string> = {
  entrega: 'bg-sky-100 text-sky-800',
  retirada: 'bg-violet-100 text-violet-800',
  devolucao: 'bg-amber-100 text-amber-800',
  vencimento: 'bg-slate-100 text-slate-700',
  financeiro_receber: 'bg-emerald-100 text-emerald-800',
  financeiro_pagar: 'bg-rose-100 text-rose-800',
};

/** Número clicável de um card de indicadores; destaca em vermelho quando é um problema. */
const Metric: React.FC<{ label: string; value: React.ReactNode; alert?: boolean; onClick?: () => void }> = ({ label, value, alert, onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick} className={cx('text-left rounded-lg px-2 py-1.5 -mx-2 min-w-0', onClick && 'hover:bg-slate-50')}>
    <span className={cx('block text-xl font-bold tabular-nums', alert ? 'text-red-600' : 'text-slate-900')}>{value}</span>
    <span className="block text-xs text-slate-500 leading-tight">{label}</span>
  </button>
);

const ModuleCard: React.FC<{ title: string; icon: React.ElementType; onOpen: () => void; children: React.ReactNode; footer?: React.ReactNode; extra?: React.ReactNode }> = ({ title, icon: Icon, onOpen, children, footer, extra }) => (
  <Card
    title={<span className="flex items-center gap-2"><Icon className="w-4 h-4 text-[#1e3a5f]" />{title}</span>}
    actions={
      <div className="flex items-center gap-3">
        {extra}
        <button onClick={onOpen} className="text-xs font-semibold text-[#1e3a5f] hover:underline flex items-center gap-1">Abrir <ArrowRight className="w-3 h-3" /></button>
      </div>
    }
  >
    <div className="grid grid-cols-2 gap-x-4 gap-y-1">{children}</div>
    {footer && <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-600">{footer}</div>}
  </Card>
);

const HIDE_KEY = 'painel.ocultarValores';
const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};

export const PainelGeral: React.FC<{ user: AuthUser; onOpenLink: (l: Link) => void; onAction: (a: PainelAction) => void }> = ({ user, onOpenLink, onAction }) => {
  const { data, error, loading, reload } = useAsync(() => api.get<Home>('/home'), []);
  // olho do card Financeiro: esconde os valores (preferência deste navegador)
  const [hidden, setHidden] = useState(readHidden);
  const toggleHidden = () =>
    setHidden((h) => {
      try {
        localStorage.setItem(HIDE_KEY, h ? '0' : '1');
      } catch {
        /* sem armazenamento: vale só nesta tela */
      }
      return !h;
    });
  const money = (v: number) => (hidden ? 'R$ ••••••' : formatBRL(v));
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error || 'Erro'} onRetry={reload} />;
  const { contratos: c, financeiro: f, estoque: e, logistica: l, orcamentos: q } = data;
  const go = (module: string, page: string, id?: number) => onOpenLink({ module, page, id });
  const dateLabel = new Date(`${data.today}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const lateCount = data.agenda.filter((a) => a.late).length;

  return (
    <div className="space-y-5">
      {/* Cabeçalho + ações rápidas */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Olá, {user.name.split(' ')[0]}</h1>
          <p className="text-sm text-slate-500 first-letter:uppercase">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.acoes.novo_orcamento && <Button size="sm" variant="primary" icon={FilePlus2} onClick={() => onAction('novo_orcamento')}>Novo orçamento</Button>}
          {data.acoes.novo_contrato && <Button size="sm" icon={FileSignature} onClick={() => onAction('novo_contrato')}>Novo contrato</Button>}
          {data.acoes.nova_entrega && <Button size="sm" icon={Truck} onClick={() => onAction('nova_entrega')}>Programar entrega</Button>}
          {data.acoes.nova_entrega && <Button size="sm" icon={PackageCheck} onClick={() => onAction('nova_retirada')}>Registrar retirada</Button>}
          {data.acoes.estoque && <Button size="sm" icon={Boxes} onClick={() => onAction('disponibilidade')}>Disponibilidade</Button>}
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={reload} aria-label="Atualizar painel" title="Atualizar" />
        </div>
      </div>

      {/* Agenda do dia + alertas críticos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card
          className="lg:col-span-2"
          bodyClassName="p-0"
          title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[#1e3a5f]" />Agenda de hoje{lateCount > 0 && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[11px] font-semibold">{lateCount} atrasada(s)</span>}</span>}
        >
          {data.agenda.length === 0 ? (
            <p className="px-4 py-10 text-sm text-slate-500 text-center">Nada programado para hoje e nenhuma pendência atrasada.</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto">
              {data.agenda.map((a, i) => (
                <li key={i}>
                  <button onClick={() => onOpenLink(a.link)} className={cx('w-full text-left px-4 py-2.5 border-t border-slate-100 first:border-0 hover:bg-slate-50 flex items-center gap-3', a.late && 'bg-red-50/50')}>
                    <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-slate-600">
                      {a.time ? new Date(a.time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : a.late ? <span className="text-red-600">atraso</span> : 'hoje'}
                    </span>
                    <span className={cx('shrink-0 px-1.5 py-0.5 rounded text-[11px] font-semibold', AGENDA_STYLE[a.kind] || 'bg-slate-100 text-slate-700')}>{a.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 truncate">{a.ref}</span>
                      <span className={cx('block text-xs truncate', a.late ? 'text-red-600' : 'text-slate-500')}>{a.text}</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          bodyClassName="p-0"
          title={<span className="flex items-center gap-2"><AlertOctagon className="w-4 h-4 text-red-600" />Alertas importantes</span>}
          actions={<button onClick={() => onAction('notificacoes')} className="text-xs font-semibold text-[#1e3a5f] hover:underline">Ver todos</button>}
        >
          {data.alertas.length === 0 ? (
            <p className="px-4 py-10 text-sm text-slate-500 text-center">Nenhum alerta crítico ou de alta prioridade.</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto">
              {data.alertas.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={async () => { await api.post(`/notification-center/${a.id}/read`).catch(() => undefined); if (a.link) onOpenLink(a.link); }}
                    className="w-full text-left px-4 py-2.5 border-t border-slate-100 first:border-0 hover:bg-slate-50 flex gap-2.5"
                  >
                    <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', a.priority === 'critica' ? 'bg-red-500' : 'bg-orange-400')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800 truncate">{a.title}</span>
                      <span className="block text-xs text-slate-600 line-clamp-2">{a.message}</span>
                      <span className="block text-[11px] text-slate-400">{a.priority === 'critica' ? 'Crítico' : 'Alta'} • {formatDateTimeBR(a.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Indicadores por módulo */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {c && (
          <ModuleCard title="Contratos" icon={FileSignature} onOpen={() => go('contratos', 'painel')} footer={c.valor_mensal_ativo !== null && <>Receita mensal dos contratos ativos: <strong>{formatBRL(c.valor_mensal_ativo)}</strong></>}>
            <Metric label="Ativos" value={c.ativos} onClick={() => go('contratos', 'painel')} />
            <Metric label={`Vencem em até ${c.alert_horizon_days} dias`} value={c.vencendo} onClick={() => go('contratos', 'alertas')} />
            <Metric label="Vencidos / aguardando devolução" value={c.vencidos} alert={c.vencidos > 0} onClick={() => go('contratos', 'alertas')} />
            <Metric label="Em elaboração / assinatura" value={c.em_elaboracao + c.aguardando_assinatura} onClick={() => go('contratos', 'painel')} />
          </ModuleCard>
        )}
        {f && (
          <ModuleCard
            title="Financeiro"
            icon={Landmark}
            onOpen={() => go('financeiro', 'dashboard')}
            footer={<>Saldo atual em contas: <strong>{money(f.saldo_atual)}</strong></>}
            extra={
              <button onClick={toggleHidden} className="p-1 rounded-md text-slate-500 hover:text-[#1e3a5f] hover:bg-slate-100" title={hidden ? 'Mostrar valores' : 'Esconder valores'} aria-label={hidden ? 'Mostrar valores' : 'Esconder valores'} aria-pressed={hidden}>
                {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          >
            <Metric label="A receber em aberto" value={money(f.a_receber_aberto)} onClick={() => go('financeiro', 'receber')} />
            <Metric label="A pagar em aberto" value={money(f.a_pagar_aberto)} onClick={() => go('financeiro', 'pagar')} />
            <Metric label="Recebimentos vencidos" value={money(f.vencido_receber)} alert={f.vencido_receber > 0} onClick={() => go('financeiro', 'receber')} />
            <Metric label="Pagamentos vencidos" value={money(f.vencido_pagar)} alert={f.vencido_pagar > 0} onClick={() => go('financeiro', 'pagar')} />
          </ModuleCard>
        )}
        {l && (
        <ModuleCard title="Entregas e devoluções" icon={Truck} onOpen={() => go('logistica', 'painel')}>
          <Metric label="Entregas hoje" value={l.entregas_hoje} onClick={() => go('logistica', 'painel')} />
          <Metric label="Entregas pendentes" value={l.entregas_pendentes + l.entregas_andamento} onClick={() => go('logistica', 'painel')} />
          <Metric label="Devoluções atrasadas" value={l.devolucoes_atrasadas} alert={l.devolucoes_atrasadas > 0} onClick={() => go('logistica', 'painel')} />
          <Metric label="Aguardando conferência" value={l.aguardando_conferencia} onClick={() => go('logistica', 'painel')} />
        </ModuleCard>
        )}
        {q && (
        <ModuleCard
          title="Orçamentos"
          icon={FileText}
          onOpen={() => go('orcamentos', 'painel')}
          footer={<>Conversão: <strong>{q.taxa_conversao === null ? '—' : `${Math.round(q.taxa_conversao * 100)}%`}</strong>{q.valor_aprovado !== null && <> • Aprovado: <strong>{formatBRL(q.valor_aprovado)}</strong></>}</>}
        >
          <Metric label="Em elaboração" value={q.elaboracao} onClick={() => go('orcamentos', 'lista')} />
          <Metric label="Aguardando cliente" value={q.aguardando} onClick={() => go('orcamentos', 'lista')} />
          <Metric label="Aguardando aprovação interna" value={q.aguardando_aprovacao_interna} onClick={() => go('orcamentos', 'lista')} />
          <Metric label="Aprovados" value={q.aprovados} onClick={() => go('orcamentos', 'lista')} />
        </ModuleCard>
        )}
        {e && (
        <ModuleCard title="Estoque e equipamentos" icon={Boxes} onOpen={() => go('estoque', 'painel')}>
          <Metric label="Equipamentos disponíveis" value={e.eq_disponiveis} onClick={() => go('estoque', 'disponibilidade')} />
          <Metric label="Alugados / reservados" value={e.eq_alugados + e.eq_reservados} onClick={() => go('estoque', 'ativos')} />
          <Metric label="Manutenção / inspeção / avariados" value={e.eq_manutencao + e.eq_inspecao + e.eq_danificados} alert={e.eq_danificados > 0} onClick={() => go('estoque', 'ativos')} />
          <Metric label="Itens abaixo do mínimo / sem saldo" value={e.abaixo_minimo + e.sem_saldo} alert={e.abaixo_minimo + e.sem_saldo > 0} onClick={() => go('estoque', 'itens')} />
        </ModuleCard>
        )}
      </div>

      {/* Ocupação da frota de locação */}
      {data.ocupacao && (
      <Card
        title="Ocupação da frota de locação"
        actions={<button onClick={() => go('estoque', 'disponibilidade')} className="text-xs font-semibold text-[#1e3a5f] hover:underline flex items-center gap-1">Disponibilidade <ArrowRight className="w-3 h-3" /></button>}
      >
        {data.ocupacao.percentual === null ? (
          <p className="text-sm text-slate-500 py-6 text-center">Nenhum item de locação com saldo cadastrado.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-6 items-start">
            <div>
              <p className="text-4xl font-bold text-slate-900 tabular-nums">{data.ocupacao.percentual.toLocaleString('pt-BR')}%</p>
              <p className="text-xs text-slate-500">da frota (peças e equipamentos) está com clientes agora</p>
            </div>
            <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3 min-w-0" aria-label="Ocupação por item: em uso, total e percentual">
              {data.ocupacao.itens.map((it) => (
                <li key={it.id} className="min-w-0" title={`${it.description}: ${it.em_uso.toLocaleString('pt-BR')} de ${it.total.toLocaleString('pt-BR')} em uso (${it.percentual.toLocaleString('pt-BR')}%)`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-slate-800">
                      {it.description} <span className="text-[11px] text-slate-400">{it.internal_code}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-xs text-slate-600">
                      {it.em_uso.toLocaleString('pt-BR')} / {it.total.toLocaleString('pt-BR')} <span className="font-semibold text-slate-800">({it.percentual.toLocaleString('pt-BR')}%)</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-slate-100 overflow-hidden" role="presentation">
                    <div className="h-full rounded bg-[#2AA3D8]" style={{ width: `${Math.max(it.percentual, it.em_uso ? 2 : 0)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      )}
    </div>
  );
};
