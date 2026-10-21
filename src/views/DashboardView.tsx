/**
 * Central Locação - Painel Geral e Métricas em Tempo Real (Dashboard & BI)
 * Lynus Tecnologia
 */

import React from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrencyBRL } from '../utils/billing';
import {
  TrendingUp,
  Boxes,
  FileCheck2,
  AlertTriangle,
  Receipt,
  RotateCcw,
  PlusCircle,
  Truck,
  Wrench,
  ShieldAlert,
  ArrowUpRight,
  Clock,
  PieChart,
} from 'lucide-react';
import { ActiveTab } from '../components/Navbar';

interface DashboardViewProps {
  onNavigate: (tab: ActiveTab) => void;
  onOpenNovoContrato: () => void;
  onOpenNovaDevolucao: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onOpenNovoContrato,
  onOpenNovaDevolucao,
}) => {
  const {
    contratos,
    faturas,
    clientes,
    equipamentos,
    patrimonios,
    estoqueGranel,
    ordensServico,
    logistica,
  } = useApp();

  // Métricas
  const contratosAtivos = contratos.filter((c) => c.status === 'ativo');
  const totalFaturadoMes = faturas
    .filter((f) => f.status === 'paga')
    .reduce((acc, f) => acc + f.valorTotal, 0);

  const faturasAbertas = faturas.filter((f) => f.status === 'aberta');
  const totalReceber = faturasAbertas.reduce((acc, f) => acc + f.valorTotal, 0);

  const clientesInadimplentes = clientes.filter((c) => c.bloqueado);

  // Taxa de ocupação estimada (granel + serializado)
  const totalItensGranel = estoqueGranel.reduce((acc, eg) => acc + eg.total, 0);
  const locadosGranel = estoqueGranel.reduce((acc, eg) => acc + eg.locado, 0);

  const totalPatrimonios = patrimonios.length;
  const locadosPatrimonios = patrimonios.filter((p) => p.status === 'locado').length;

  const taxaOcupacaoGeral = Math.round(
    ((locadosGranel + locadosPatrimonios) /
      Math.max(1, totalItensGranel + totalPatrimonios)) *
      100
  );

  const ticketMedio =
    contratosAtivos.length > 0
      ? contratosAtivos.reduce((acc, c) => acc + c.totalMensalEstimado, 0) /
        contratosAtivos.length
      : 0;

  // OS em aberto
  const osAbertas = ordensServico.filter((os) => os.status !== 'concluida');

  return (
    <div className="space-y-6">
      {/* Barra de Boas-Vindas e Ações Rápidas de Balcão */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-[#1e3a8a] text-white p-6 rounded-2xl shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="bg-[#2AA3D8] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
              Painel Operacional
            </span>
            <span className="text-slate-400 text-xs">Central BR Comércio e Locação Ltda</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white mt-1">
            Central Locadora Rio Preto
          </h1>
          <p className="text-slate-300 text-xs mt-0.5">
            Locação antecipada em ciclos de 30 dias com prorrogação automática e pro rata.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={onOpenNovoContrato}
            className="flex items-center gap-2 bg-[#2AA3D8] hover:bg-[#208fbf] text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" /> Novo Contrato / Orçamento
          </button>
          <button
            onClick={onOpenNovaDevolucao}
            className="flex items-center gap-2 bg-[#D9332B] hover:bg-[#b82720] text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" /> Registrar Devolução / Checklist
          </button>
        </div>
      </div>

      {/* Alerta de Inadimplência se houver clientes bloqueados */}
      {clientesInadimplentes.length > 0 && (
        <div className="bg-red-50 border-l-4 border-[#D9332B] p-4 rounded-xl flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-[#D9332B] shrink-0" />
            <div>
              <h3 className="text-xs font-bold text-red-900 uppercase">
                Atenção Balcão: {clientesInadimplentes.length} cliente(s) com locações bloqueadas por inadimplência
              </h3>
              <p className="text-xs text-red-700">
                {clientesInadimplentes.map((c) => c.nomeRazao).join(', ')} possuem títulos vencidos. O sistema bloqueia automaticamente a emissão de novos contratos.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('clientes')}
            className="text-xs font-bold text-red-800 underline hover:text-red-950 shrink-0 ml-4 cursor-pointer"
          >
            Ver Clientes
          </button>
        </div>
      )}

      {/* Cards de Indicadores Principais (KPIs) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Contratos Ativos */}
        <div
          onClick={() => onNavigate('contratos')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-[#2AA3D8] cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Contratos Ativos</span>
            <div className="p-2 bg-blue-50 text-[#2AA3D8] rounded-lg group-hover:bg-[#2AA3D8] group-hover:text-white transition-colors">
              <FileCheck2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {contratosAtivos.length}
          </div>
          <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-600" />
            Ticket Médio Mensal: {formatCurrencyBRL(ticketMedio)}
          </p>
        </div>

        {/* Taxa de Ocupação */}
        <div
          onClick={() => onNavigate('estoque')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-amber-500 cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Taxa de Ocupação</span>
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {taxaOcupacaoGeral}%
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2">
            <div
              className="bg-amber-500 h-1.5 rounded-full"
              style={{ width: `${Math.min(100, taxaOcupacaoGeral)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {locadosGranel} pçs granel + {locadosPatrimonios} máquinas locadas
          </p>
        </div>

        {/* Faturamento do Mês / Financeiro */}
        <div
          onClick={() => onNavigate('financeiro')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-emerald-500 cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Faturado / Recebido</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-700 font-mono">
            {formatCurrencyBRL(totalFaturadoMes)}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            A receber em aberto: <strong className="text-slate-800">{formatCurrencyBRL(totalReceber)}</strong>
          </p>
        </div>

        {/* Manutenção e Pátio */}
        <div
          onClick={() => onNavigate('manutencao')}
          className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-indigo-500 cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Manutenção & Pátio</span>
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {osAbertas.length} OS Ativas
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Logística: {logistica.filter((l) => l.status === 'agendado').length} entregas/coletas agendadas
          </p>
        </div>
      </div>

      {/* Grade de 2 Colunas: Ocupação do Estoque e Contratos Recentes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Estoque de Andaimes e Equipamentos mais locados */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase">
                Ocupação de Andaimes e Equipamentos Críticos
              </h2>
              <p className="text-xs text-slate-500">Saldo disponível para novas locações no balcão</p>
            </div>
            <button
              onClick={() => onNavigate('estoque')}
              className="text-xs font-bold text-[#2AA3D8] hover:text-[#19759c] flex items-center gap-1 cursor-pointer"
            >
              Ver Estoque Completo <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-4">
            {estoqueGranel.slice(0, 4).map((eg) => {
              const equip = equipamentos.find((e) => e.id === eg.equipamentoId);
              const percLocado = Math.round((eg.locado / eg.total) * 100);
              return (
                <div key={eg.equipamentoId} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-800">
                      {equip?.nome || 'Equipamento'}
                    </span>
                    <span className="font-mono text-slate-600">
                      <strong className="text-emerald-700">{eg.disponivel} disp.</strong> / {eg.locado} loc. / {eg.total} total
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 flex overflow-hidden">
                    <div
                      className="bg-[#2AA3D8] h-2 transition-all"
                      style={{ width: `${percLocado}%` }}
                      title={`Locado: ${percLocado}%`}
                    />
                    <div
                      className="bg-amber-400 h-2 transition-all"
                      style={{ width: `${Math.round((eg.emManutencao / eg.total) * 100)}%` }}
                      title="Em Manutenção"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Atalho para Romaneio de Entrega */}
          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs bg-slate-50 p-3 rounded-lg">
            <div className="flex items-center gap-2 text-slate-700">
              <Truck className="w-4 h-4 text-[#2AA3D8]" />
              <span>Próxima rota de transporte: <strong>Caminhão Toco BRL-4A20</strong></span>
            </div>
            <button
              onClick={() => onNavigate('logistica')}
              className="font-bold text-[#2AA3D8] hover:underline cursor-pointer"
            >
              Ver Roteiro do Dia
            </button>
          </div>
        </div>

        {/* Resumo de Contratos Ativos e Vencendo */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase">
                Contratos em Andamento
              </h2>
              <span className="text-xs text-slate-400 font-mono">Ciclos de 30d</span>
            </div>

            <div className="space-y-3">
              {contratos.slice(0, 3).map((cnt) => {
                const cliente = clientes.find((c) => c.id === cnt.clienteId);
                return (
                  <div
                    key={cnt.id}
                    onClick={() => onNavigate('contratos')}
                    className="p-3 rounded-lg border border-slate-200 hover:border-[#2AA3D8] cursor-pointer transition-all bg-slate-50/50 hover:bg-slate-50"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-[#D9332B] text-xs">
                        Nº {cnt.numeroContrato}
                      </span>
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded ${
                          cnt.status === 'ativo'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {cnt.status}
                      </span>
                    </div>
                    <div className="font-semibold text-slate-800 text-xs truncate">
                      {cliente?.nomeRazao}
                    </div>
                    <div className="flex justify-between items-center text-[11px] text-slate-500 mt-1">
                      <span>{cnt.itens.length} item(ns) locado(s)</span>
                      <span className="font-mono font-bold text-slate-900">
                        {formatCurrencyBRL(cnt.totalMensalEstimado)}/mês
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-center">
            <button
              onClick={() => onNavigate('contratos')}
              className="text-xs font-bold text-[#2AA3D8] hover:text-[#1d82ad] cursor-pointer"
            >
              Consultar todos os {contratos.length} contratos →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
