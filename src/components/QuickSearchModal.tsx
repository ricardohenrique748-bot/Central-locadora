/**
 * Central Locação - Modal de Busca Rápida Balcão (Ctrl + K)
 */

import React, { useState, useEffect } from 'react';
import { Search, X, FileText, User, Boxes, Wrench, ArrowRight } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ActiveTab } from './Navbar';

interface QuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: ActiveTab, entityId?: string) => void;
}

export const QuickSearchModal: React.FC<QuickSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { clientes, contratos, equipamentos, patrimonios } = useApp();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
      } else if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();

  const filteredClientes = q
    ? clientes.filter(
        (c) =>
          c.nomeRazao.toLowerCase().includes(q) ||
          c.cpfCnpj.includes(q) ||
          c.telefone.includes(q)
      ).slice(0, 4)
    : [];

  const filteredContratos = q
    ? contratos.filter(
        (c) =>
          c.numeroContrato.includes(q) ||
          c.itens.some((it) => it.patrimonioIds?.some((p) => p.toLowerCase().includes(q)))
      ).slice(0, 4)
    : [];

  const filteredEquipamentos = q
    ? equipamentos.filter(
        (e) =>
          e.nome.toLowerCase().includes(q) ||
          e.codigo.toLowerCase().includes(q) ||
          e.categoria.toLowerCase().includes(q)
      ).slice(0, 4)
    : [];

  const filteredPatrimonios = q
    ? patrimonios.filter((p) => p.numeroSerie.toLowerCase().includes(q)).slice(0, 4)
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-start justify-center pt-16 px-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-2xl overflow-hidden animate-in fade-in duration-150">
        <div className="p-4 border-b border-slate-200 flex items-center gap-3">
          <Search className="w-5 h-5 text-[#2AA3D8]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite para buscar clientes, contratos, equipamentos ou patrimônios..."
            autoFocus
            className="flex-1 text-slate-800 placeholder-slate-400 focus:outline-hidden text-sm font-medium"
          />
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-4 space-y-4">
          {!q && (
            <div className="text-center py-6 text-slate-400 text-xs">
              Busque por nome do cliente, CNPJ/CPF, número do contrato (ex: 009537), código de peça (AND-150) ou número de série (MRT-15-001).
            </div>
          )}

          {q && filteredClientes.length === 0 && filteredContratos.length === 0 && filteredEquipamentos.length === 0 && filteredPatrimonios.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhum resultado encontrado para "{query}".
            </div>
          )}

          {/* Clientes */}
          {filteredClientes.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5 mb-1.5">
                <User className="w-3.5 h-3.5 text-[#2AA3D8]" /> Clientes ({filteredClientes.length})
              </span>
              <div className="space-y-1">
                {filteredClientes.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      onNavigate('clientes', c.id);
                      onClose();
                    }}
                    className="p-2.5 rounded-lg hover:bg-slate-50 border border-slate-100 cursor-pointer flex justify-between items-center group transition-colors"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 text-xs">{c.nomeRazao}</span>
                      <span className="text-[10px] text-slate-500 ml-2 font-mono">{c.cpfCnpj}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#2AA3D8] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contratos */}
          {filteredContratos.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5 mb-1.5">
                <FileText className="w-3.5 h-3.5 text-[#D9332B]" /> Contratos ({filteredContratos.length})
              </span>
              <div className="space-y-1">
                {filteredContratos.map((cnt) => (
                  <div
                    key={cnt.id}
                    onClick={() => {
                      onNavigate('contratos', cnt.id);
                      onClose();
                    }}
                    className="p-2.5 rounded-lg hover:bg-slate-50 border border-slate-100 cursor-pointer flex justify-between items-center group transition-colors"
                  >
                    <div>
                      <span className="font-bold text-[#D9332B] font-mono text-xs">Nº {cnt.numeroContrato}</span>
                      <span className="text-[11px] text-slate-600 ml-2">Status: {cnt.status.toUpperCase()}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#D9332B] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Equipamentos */}
          {filteredEquipamentos.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5 mb-1.5">
                <Boxes className="w-3.5 h-3.5 text-amber-600" /> Equipamentos ({filteredEquipamentos.length})
              </span>
              <div className="space-y-1">
                {filteredEquipamentos.map((eq) => (
                  <div
                    key={eq.id}
                    onClick={() => {
                      onNavigate('estoque', eq.id);
                      onClose();
                    }}
                    className="p-2.5 rounded-lg hover:bg-slate-50 border border-slate-100 cursor-pointer flex justify-between items-center group transition-colors"
                  >
                    <div>
                      <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1 py-0.5 rounded mr-2">{eq.codigo}</span>
                      <span className="font-semibold text-slate-900 text-xs">{eq.nome}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600 transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Patrimônios */}
          {filteredPatrimonios.length > 0 && (
            <div>
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5 mb-1.5">
                <Wrench className="w-3.5 h-3.5 text-indigo-600" /> Patrimônios Serializados ({filteredPatrimonios.length})
              </span>
              <div className="space-y-1">
                {filteredPatrimonios.map((pat) => (
                  <div
                    key={pat.id}
                    onClick={() => {
                      onNavigate('estoque', pat.id);
                      onClose();
                    }}
                    className="p-2.5 rounded-lg hover:bg-slate-50 border border-slate-100 cursor-pointer flex justify-between items-center group transition-colors"
                  >
                    <div>
                      <span className="font-mono text-xs font-bold text-indigo-700">{pat.numeroSerie}</span>
                      <span className="text-[10px] text-slate-500 ml-2">Status: {pat.status}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-400 flex justify-between items-center">
          <span>Pressione ESC para fechar</span>
          <span>Central Locadora Rio Preto ERP</span>
        </div>
      </div>
    </div>
  );
};
