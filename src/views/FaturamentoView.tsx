/**
 * Central Locação - Módulo de Faturamento & Financeiro
 * Lynus Tecnologia
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Fatura } from '../types';
import { formatCurrencyBRL } from '../utils/billing';
import {
  Receipt,
  Plus,
  Printer,
  CheckCircle2,
  XCircle,
  MessageSquare,
  AlertTriangle,
  Calendar,
  Building,
  ArrowUpRight,
  Send,
} from 'lucide-react';

interface FaturamentoViewProps {
  onSelectFaturaPrint: (fat: Fatura) => void;
}

export const FaturamentoView: React.FC<FaturamentoViewProps> = ({
  onSelectFaturaPrint,
}) => {
  const {
    faturas,
    clientes,
    contratos,
    gerarFaturaConsolidada,
    pagarFatura,
    cancelarFatura,
    configEmpresa,
  } = useApp();

  const [filtroStatus, setFiltroStatus] = useState<string>('todos');
  const [modalNovaFaturaOpen, setModalNovaFaturaOpen] = useState(false);
  const [modalCancelarOpen, setModalCancelarOpen] = useState<string | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');

  // Form de Fatura Consolidada
  const [clienteIdFatura, setClienteIdFatura] = useState('');
  const [diaCorteRef, setDiaCorteRef] = useState(new Date().toISOString().split('T')[0]);

  const clienteSelecionado = clientes.find((c) => c.id === clienteIdFatura);
  const contratosDoCliente = contratos.filter(
    (c) => c.clienteId === clienteIdFatura && c.status === 'ativo'
  );

  const faturasFiltradas = faturas.filter((f) => {
    if (filtroStatus === 'todos') return true;
    return f.status === filtroStatus;
  });

  const handleGerarFatura = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteIdFatura) {
      alert('Selecione um cliente.');
      return;
    }
    if (contratosDoCliente.length === 0) {
      alert('Este cliente não possui contratos ativos para faturar.');
      return;
    }

    const novaFat = gerarFaturaConsolidada(
      clienteIdFatura,
      contratosDoCliente.map((c) => c.id),
      diaCorteRef
    );

    setModalNovaFaturaOpen(false);
    onSelectFaturaPrint(novaFat);
  };

  const handleConfirmarCancelamento = (fatId: string) => {
    if (!motivoCancelamento.trim()) {
      alert('Informe o motivo do cancelamento.');
      return;
    }
    cancelarFatura(fatId, motivoCancelamento);
    setModalCancelarOpen(null);
    setMotivoCancelamento('');
  };

  // Gerar mensagem de WhatsApp para régua de cobrança
  const gerarLinkWhatsApp = (fat: Fatura) => {
    const cli = clientes.find((c) => c.id === fat.clienteId);
    if (!cli) return '#';

    const texto = encodeURIComponent(
      `Olá, ${cli.nomeRazao}!\n\nSegue a Fatura de Locação nº ${fat.numeroFatura} da ${configEmpresa.nomeFantasia}.\nValor: ${formatCurrencyBRL(fat.valorTotal)}\nVencimento: ${new Date(fat.dataVencimento + 'T00:00:00').toLocaleDateString('pt-BR')}\n\nChave PIX (CNPJ): ${fat.chavePix}\n\nQualquer dúvida estamos à disposição!\nCentral Locadora Rio Preto`
    );

    const foneLimpo = cli.telefone.replace(/\D/g, '');
    return `https://wa.me/55${foneLimpo}?text=${texto}`;
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[#2AA3D8]" />
            Faturamento Consolidado & Contas a Receber
          </h1>
          <p className="text-xs text-slate-500">
            Faturas consolidadas por cliente/obra com cálculo pro rata, canhoto de entrega e PIX.
          </p>
        </div>

        <button
          onClick={() => setModalNovaFaturaOpen(true)}
          className="flex items-center gap-2 bg-[#2AA3D8] hover:bg-[#1f87b3] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Emitir Fatura Consolidada
        </button>
      </div>

      {/* Filtro de Status */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
        <div className="flex gap-2">
          {['todos', 'aberta', 'paga', 'cancelada'].map((st) => (
            <button
              key={st}
              onClick={() => setFiltroStatus(st)}
              className={`px-3 py-1.5 rounded-lg font-bold capitalize transition-colors cursor-pointer ${
                filtroStatus === st
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st} ({faturas.filter((f) => (st === 'todos' ? true : f.status === st)).length})
            </button>
          ))}
        </div>

        <span className="text-[11px] text-slate-500 hidden sm:inline">
          Faturas emitidas são imutáveis (conforme regra de negócio 5: cancela e reemite com motivo)
        </span>
      </div>

      {/* Tabela de Faturas */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-left font-bold uppercase text-[10.5px]">
              <th className="p-3 w-32">Nº Fatura</th>
              <th className="p-3">Cliente / Pagador</th>
              <th className="p-3">Emissão</th>
              <th className="p-3">Vencimento</th>
              <th className="p-3 text-right">Valor Total</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {faturasFiltradas.map((fat) => {
              const cli = clientes.find((c) => c.id === fat.clienteId);
              return (
                <tr key={fat.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-mono font-black text-[#D9332B] text-sm">
                    {fat.numeroFatura}
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{cli?.nomeRazao}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{cli?.cpfCnpj}</div>
                  </td>
                  <td className="p-3 font-mono text-slate-600">
                    {new Date(fat.dataEmissao + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className="p-3 font-mono font-bold text-slate-800">
                    {new Date(fat.dataVencimento + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className="p-3 text-right font-mono font-black text-slate-900 text-sm">
                    {formatCurrencyBRL(fat.valorTotal)}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        fat.status === 'paga'
                          ? 'bg-emerald-100 text-emerald-800'
                          : fat.status === 'aberta'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {fat.status}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    {fat.status === 'aberta' && (
                      <>
                        <button
                          onClick={() => pagarFatura(fat.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
                          title="Dar baixa / Registrar recebimento"
                        >
                          Baixa
                        </button>
                        <a
                          href={gerarLinkWhatsApp(fat)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 shadow-2xs transition-colors"
                          title="Cobrança via WhatsApp"
                        >
                          <MessageSquare className="w-3 h-3 text-emerald-600" /> Cobrar
                        </a>
                        <button
                          onClick={() => setModalCancelarOpen(fat.id)}
                          className="bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-700 border border-slate-300 px-2 py-1 rounded text-[11px] font-bold transition-colors cursor-pointer"
                          title="Cancelar fatura com justificativa"
                        >
                          Cancelar
                        </button>
                      </>
                    )}

                    <button
                      onClick={() => onSelectFaturaPrint(fat)}
                      className="bg-[#2AA3D8] hover:bg-[#1a85b3] text-white px-2.5 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" /> Fatura (3.3)
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Emitir Fatura Consolidada */}
      {modalNovaFaturaOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-lg p-6">
            <h2 className="text-base font-black text-slate-900 uppercase mb-3">
              Emitir Fatura de Locação Consolidada
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Agrupa todos os contratos ativos do cliente até o dia de corte com cálculo pro rata dos ciclos.
            </p>

            <form onSubmit={handleGerarFatura} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cliente *</label>
                <select
                  value={clienteIdFatura}
                  onChange={(e) => setClienteIdFatura(e.target.value)}
                  required
                  className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                >
                  <option value="">Selecione o cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nomeRazao} (Dia de corte padrão: {c.diaCorteFaturamento})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Data de Corte do Período *
                </label>
                <input
                  type="date"
                  value={diaCorteRef}
                  onChange={(e) => setDiaCorteRef(e.target.value)}
                  required
                  className="w-full text-xs border border-slate-300 rounded p-2"
                />
              </div>

              {clienteSelecionado && (
                <div className="bg-slate-50 p-3 rounded border border-slate-200 text-xs space-y-1">
                  <div className="font-bold text-slate-800">
                    Contratos Ativos Encontrados: {contratosDoCliente.length}
                  </div>
                  {contratosDoCliente.map((c) => (
                    <div key={c.id} className="text-slate-600 flex justify-between">
                      <span>Contrato {c.numeroContrato} ({c.itens.length} itens)</span>
                      <span className="font-mono">{formatCurrencyBRL(c.totalMensalEstimado)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalNovaFaturaOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={contratosDoCliente.length === 0}
                  className="px-4 py-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white text-xs font-bold rounded disabled:opacity-50"
                >
                  Gerar Fatura & Canhoto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Cancelar Fatura com Justificativa */}
      {modalCancelarOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-md p-6">
            <h2 className="text-base font-black text-slate-900 uppercase mb-2">
              Cancelar Fatura
            </h2>
            <p className="text-xs text-red-600 mb-4">
              Por regra fiscal e auditoria, faturas emitidas não podem ser alteradas, apenas canceladas e reemitidas com registro do motivo.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Motivo do Cancelamento *
                </label>
                <textarea
                  rows={3}
                  value={motivoCancelamento}
                  onChange={(e) => setMotivoCancelamento(e.target.value)}
                  placeholder="Ex: Correção de período pro rata solicitado pelo cliente"
                  className="w-full text-xs border border-slate-300 rounded p-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalCancelarOpen(null)}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded text-slate-700"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmarCancelamento(modalCancelarOpen)}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded"
                >
                  Confirmar Cancelamento
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
