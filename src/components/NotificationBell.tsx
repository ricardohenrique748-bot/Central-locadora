/**
 * Sino de notificações do cabeçalho: contador de não lidas do usuário e painel com as recentes.
 * Atualiza a cada minuto; nada interrompe o trabalho (sem pop-ups).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { CATEGORY_LABELS, NotificationItem, NotificationLink } from '../../shared/notificacoes/types';
import { api } from '../modules/orcamentos/api';
import { formatDateTimeBR } from '../../shared/orcamentos/dates';

const DOT: Record<string, string> = { critica: 'bg-red-500', alta: 'bg-orange-400', media: 'bg-sky-400', baixa: 'bg-slate-400' };

export const NotificationBell: React.FC<{ onOpenLink: (l: NotificationLink) => void; onOpenCenter: () => void }> = ({ onOpenLink, onOpenCenter }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; critical: number; recent: NotificationItem[] } | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const load = () =>
    api
      .get<{ unread: number; critical: number; recent: NotificationItem[] }>('/notification-center/summary')
      .then((d) => (setData(d), setError(false)))
      .catch(() => setError(true));
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const openItem = async (n: NotificationItem) => {
    setOpen(false);
    if (!n.read_at) await api.post(`/notification-center/${n.id}/read`).catch(() => undefined);
    load();
    if (n.link) onOpenLink(n.link);
  };
  const unread = data?.unread || 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (setOpen((o) => !o), load())}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
        aria-label={`Notificações: ${unread} não lida(s)`}
        title="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${data?.critical ? 'bg-red-600' : 'bg-[#2AA3D8]'}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[360px] bg-white text-slate-800 border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-bold">Notificações {unread > 0 && <span className="text-xs font-semibold text-slate-500">({unread} não lida{unread > 1 ? 's' : ''})</span>}</span>
            {unread > 0 && (
              <button className="text-xs font-semibold text-[#1e3a5f] hover:underline flex items-center gap-1" onClick={async () => (await api.post('/notification-center/read-all').catch(() => undefined), load())}>
                <CheckCheck className="w-3.5 h-3.5" /> Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {error && <p className="px-4 py-6 text-sm text-red-600 text-center">Não foi possível carregar as notificações.</p>}
            {!error && data && data.recent.length === 0 && <p className="px-4 py-8 text-sm text-slate-500 text-center">Nenhuma notificação pendente.</p>}
            {data?.recent.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={`w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 flex gap-2.5 ${n.read_at ? 'opacity-70' : ''}`}>
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${DOT[n.priority]}`} aria-label={`prioridade ${n.priority}`} />
                <span className="min-w-0">
                  <span className={`block text-sm truncate ${n.read_at ? 'font-medium' : 'font-semibold'}`}>{n.title}</span>
                  <span className="block text-xs text-slate-600 line-clamp-2">{n.message}</span>
                  <span className="block text-[11px] text-slate-400 mt-0.5">
                    {CATEGORY_LABELS[n.category]} • {formatDateTimeBR(n.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => (setOpen(false), onOpenCenter())} className="w-full px-4 py-2.5 text-sm font-semibold text-[#1e3a5f] hover:bg-slate-50 border-t border-slate-100">
            Ver todas as notificações
          </button>
        </div>
      )}
    </div>
  );
};
