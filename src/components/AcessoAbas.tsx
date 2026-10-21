/**
 * Acesso às abas por usuário (só o administrador). "Todas" = sem restrição (vale o perfil);
 * marcando abas, o usuário passa a ver e mexer apenas nelas. O servidor também bloqueia o resto.
 */

import React, { useEffect, useState } from 'react';
import { LayoutGrid, Save, Loader2 } from 'lucide-react';
import { MODULE_KEYS, MODULE_LABELS, ModuleKey } from '../../shared/acesso';
import { ROLE_LABELS, Role } from '../../shared/orcamentos/types';
import { api, ApiError } from '../modules/orcamentos/api';

type Row = { id: number; name: string; email: string; role: Role; active: boolean; modules: ModuleKey[] | null };

export const AcessoAbas: React.FC = () => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<number, ModuleKey[] | null>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    api
      .get<{ rows: Row[] }>('/users')
      .then((r) => {
        setRows(r.rows);
        setDraft(Object.fromEntries(r.rows.map((u) => [u.id, u.modules])));
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  useEffect(() => {
    load();
  }, []);

  const toggle = (id: number, m: ModuleKey) =>
    setDraft((d) => {
      const cur = d[id] ?? [];
      return { ...d, [id]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
    });
  const changed = (u: Row) => JSON.stringify([...(draft[u.id] ?? ['*'])].sort()) !== JSON.stringify([...(u.modules ?? ['*'])].sort());
  const save = async (u: Row) => {
    const modules = draft[u.id];
    if (modules && modules.length === 0) return setMsg({ ok: false, text: `Marque ao menos uma aba para ${u.name} ou volte para "Todas".` });
    setSaving(u.id);
    try {
      await api.put(`/users/${u.id}/modules`, { modules });
      setMsg({ ok: true, text: `Acesso de ${u.name} salvo. Vale a partir da próxima tela que ele abrir.` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as ApiError).message });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-[#2AA3D8]" /> Acesso às abas
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          Escolha em quais abas cada usuário pode entrar e mexer. <b>Todas</b> = sem restrição (vale o perfil). O administrador sempre acessa tudo. Painel Geral, Notificações e Configurações ficam para todos.
        </p>
      </div>
      {msg && <p className={`px-4 py-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      {!rows ? (
        <p className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando usuários...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-slate-50 text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Usuário</th>
                <th className="px-2 py-2 font-semibold">Todas</th>
                {MODULE_KEYS.map((m) => (
                  <th key={m} className="px-2 py-2 font-semibold">{MODULE_LABELS[m].replace(' (entregas e devoluções)', '')}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const admin = u.role === 'admin';
                const mods = draft[u.id];
                return (
                  <tr key={u.id} className={`border-t border-slate-100 ${u.active ? '' : 'opacity-50'}`}>
                    <td className="px-4 py-2">
                      <p className="font-semibold text-slate-800 text-sm">{u.name}</p>
                      <p className="text-slate-500">{ROLE_LABELS[u.role]}{u.active ? '' : ' • inativo'}</p>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input type="checkbox" className="w-4 h-4 accent-[#2AA3D8]" aria-label={`${u.name}: todas as abas`} checked={admin || mods === null} disabled={admin} onChange={(e) => setDraft((d) => ({ ...d, [u.id]: e.target.checked ? null : [] }))} />
                    </td>
                    {MODULE_KEYS.map((m) => (
                      <td key={m} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[#2AA3D8]"
                          aria-label={`${u.name}: ${MODULE_LABELS[m]}`}
                          disabled={admin || mods === null}
                          checked={admin || mods === null || !!mods?.includes(m)}
                          onChange={() => toggle(u.id, m)}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">
                      {!admin && changed(u) && (
                        <button onClick={() => save(u)} disabled={saving === u.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#1e3a5f] text-white font-semibold disabled:opacity-60">
                          {saving === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Salvar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
