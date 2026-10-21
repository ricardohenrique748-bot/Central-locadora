/**
 * Central Locação - Módulo de Manutenção & Ordens de Serviço (OS)
 * Lynus Tecnologia
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { OrdemServico } from '../types';
import { formatCurrencyBRL } from '../utils/billing';
import {
  Wrench,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  DollarSign,
  Activity,
} from 'lucide-react';

export const ManutencaoView: React.FC = () => {
  const {
    ordensServico,
    patrimonios,
    equipamentos,
    criarOrdemServico,
    atualizarOrdemServico,
  } = useApp();

  const [modalNovaOSOpen, setModalNovaOSOpen] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');

  // Form State
  const [patrimonioId, setPatrimonioId] = useState('');
  const [tipo, setTipo] = useState<'preventiva' | 'corretiva'>('corretiva');
  const [diagnostico, setDiagnostico] = useState('');
  const [mecanico, setMecanico] = useState('Rogério Manutenção');
  const [custoPecas, setCustoPecas] = useState(0);
  const [custoMaoObra, setCustoMaoObra] = useState(0);

  const handleSalvarOS = (e: React.FormEvent) => {
    e.preventDefault();
    const pat = patrimonios.find((p) => p.id === patrimonioId);
    if (!pat) return;

    criarOrdemServico({
      patrimonioId: pat.id,
      equipamentoId: pat.equipamentoId,
      tipo,
      status: 'em_andamento',
      dataAbertura: new Date().toISOString().split('T')[0],
      mecanicoResponsavel: mecanico,
      custoPecas,
      custoMaoObra,
      horasParado: 0,
      diagnostico,
    });

    setModalNovaOSOpen(false);
    setPatrimonioId('');
    setDiagnostico('');
    setCustoPecas(0);
    setCustoMaoObra(0);
  };

  const handleConcluirOS = (os: OrdemServico) => {
    const servicos = prompt('Descreva os serviços concluídos na máquina:');
    if (!servicos) return;

    atualizarOrdemServico(os.id, {
      status: 'concluida',
      dataConclusao: new Date().toISOString().split('T')[0],
      servicosExecutados: servicos,
    });
  };

  const osFiltradas = ordensServico.filter((os) => {
    if (filtroStatus === 'todos') return true;
    return os.status === filtroStatus;
  });

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[#2AA3D8]" />
            Manutenção & Ordens de Serviço (OS)
          </h1>
          <p className="text-xs text-slate-500">
            Controle de revisões preventivas, corretivas, peças de reposição e tempo parado por patrimônio.
          </p>
        </div>

        <button
          onClick={() => setModalNovaOSOpen(true)}
          className="flex items-center gap-2 bg-[#2AA3D8] hover:bg-[#1e86b3] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Abrir Ordem de Serviço
        </button>
      </div>

      {/* Tabela de OS */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-left font-bold uppercase text-[10.5px]">
              <th className="p-3 w-28">Nº OS</th>
              <th className="p-3">Patrimônio / Série</th>
              <th className="p-3">Equipamento</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Abertura</th>
              <th className="p-3">Diagnóstico / Defeito</th>
              <th className="p-3 text-right">Custo Peças + MO</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {osFiltradas.map((os) => {
              const pat = patrimonios.find((p) => p.id === os.patrimonioId);
              const eq = equipamentos.find((e) => e.id === os.equipamentoId);
              const totalCusto = os.custoPecas + os.custoMaoObra;

              return (
                <tr key={os.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-mono font-bold text-slate-900">{os.numeroOS}</td>
                  <td className="p-3 font-mono font-black text-indigo-700">
                    {pat?.numeroSerie || 'N/A'}
                  </td>
                  <td className="p-3 font-medium text-slate-900">{eq?.nome}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        os.tipo === 'preventiva'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {os.tipo}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-slate-600">
                    {new Date(os.dataAbertura + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </td>
                  <td className="p-3 text-slate-700 max-w-xs truncate" title={os.diagnostico}>
                    {os.diagnostico}
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-slate-900">
                    {formatCurrencyBRL(totalCusto)}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        os.status === 'concluida'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {os.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {os.status !== 'concluida' ? (
                      <button
                        onClick={() => handleConcluirOS(os)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
                      >
                        Concluir e Liberar
                      </button>
                    ) : (
                      <span className="text-[11px] text-emerald-700 font-semibold flex items-center justify-end gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Liberado
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Abertura de OS */}
      {modalNovaOSOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-lg p-6">
            <h2 className="text-base font-black text-slate-900 uppercase mb-4">
              Abertura de Ordem de Serviço (OS)
            </h2>

            <form onSubmit={handleSalvarOS} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Patrimônio Serializado *
                </label>
                <select
                  value={patrimonioId}
                  onChange={(e) => setPatrimonioId(e.target.value)}
                  required
                  className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                >
                  <option value="">Selecione a máquina...</option>
                  {patrimonios.map((p) => {
                    const eq = equipamentos.find((e) => e.id === p.equipamentoId);
                    return (
                      <option key={p.id} value={p.id}>
                        [{p.numeroSerie}] {eq?.nome} (Status: {p.status})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tipo de Manutenção</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                  >
                    <option value="corretiva">Corretiva (Reparo / Avaria)</option>
                    <option value="preventiva">Preventiva (Revisão Periódica)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Mecânico / Técnico</label>
                  <input
                    type="text"
                    value={mecanico}
                    onChange={(e) => setMecanico(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Diagnóstico / Defeito Reclamado *
                </label>
                <textarea
                  rows={3}
                  required
                  value={diagnostico}
                  onChange={(e) => setDiagnostico(e.target.value)}
                  placeholder="Ex: Motor sem força, queima de carvão, faiscamento no induzido..."
                  className="w-full text-xs border border-slate-300 rounded p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Custo Estimado Peças (R$)</label>
                  <input
                    type="number"
                    value={custoPecas}
                    onChange={(e) => setCustoPecas(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Custo Mão de Obra (R$)</label>
                  <input
                    type="number"
                    value={custoMaoObra}
                    onChange={(e) => setCustoMaoObra(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded p-2 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalNovaOSOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white text-xs font-bold rounded"
                >
                  Abrir OS
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
