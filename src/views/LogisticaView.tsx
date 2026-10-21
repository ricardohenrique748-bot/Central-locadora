/**
 * Central Locação - Módulo de Logística & Romaneio de Pátio
 * Lynus Tecnologia
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { ItemLogistica } from '../types';
import { formatCurrencyBRL } from '../utils/billing';
import {
  Truck,
  Plus,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowRight,
  MapPin,
  User,
} from 'lucide-react';

export const LogisticaView: React.FC = () => {
  const { logistica, clientes, contratos, agendarLogistica, atualizarLogisticaStatus } = useApp();

  const [modalNovoAgendamentoOpen, setModalNovoAgendamentoOpen] = useState(false);
  const [tipo, setTipo] = useState<'entrega' | 'recolhimento'>('entrega');
  const [contratoId, setContratoId] = useState('');
  const [dataAgendada, setDataAgendada] = useState(new Date().toISOString().split('T')[0]);
  const [turno, setTurno] = useState<'manha' | 'tarde'>('manha');
  const [motorista, setMotorista] = useState('Claudio Bento');
  const [veiculo, setVeiculo] = useState('BRL-4A20 (Mercedes Accelo)');
  const [valorFrete, setValorFrete] = useState(120);
  const [itensResumo, setItensResumo] = useState('');

  const contratoSelecionado = contratos.find((c) => c.id === contratoId);
  const clienteSelecionado = clientes.find((c) => c.id === contratoSelecionado?.clienteId);

  const handleSalvarAgendamento = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contratoSelecionado || !clienteSelecionado) return;

    agendarLogistica({
      tipo,
      contratoId: contratoSelecionado.id,
      clienteId: clienteSelecionado.id,
      obraId: contratoSelecionado.obraId,
      dataAgendada,
      turno,
      motorista,
      veiculoPlaca: veiculo,
      status: 'agendado',
      valorFrete,
      itensResumo: itensResumo || 'Materiais constantes no contrato',
    });

    setModalNovoAgendamentoOpen(false);
    setItensResumo('');
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <Truck className="w-5 h-5 text-[#2AA3D8]" />
            Logística, Pátio & Romaneio de Rotas
          </h1>
          <p className="text-xs text-slate-500">
            Agendamento de transporte (entregas e recolhimentos em obras de Rio Preto e região).
          </p>
        </div>

        <button
          onClick={() => setModalNovoAgendamentoOpen(true)}
          className="flex items-center gap-2 bg-[#2AA3D8] hover:bg-[#1e86b3] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Agendar Rota / Transporte
        </button>
      </div>

      {/* Grade de Roteiros */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {logistica.map((item) => {
          const cli = clientes.find((c) => c.id === item.clienteId);
          const cnt = contratos.find((c) => c.id === item.contratoId);
          const obr = cli?.obras.find((o) => o.id === item.obraId);

          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                      item.tipo === 'entrega'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.tipo}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      item.status === 'concluido'
                        ? 'bg-emerald-100 text-emerald-800'
                        : item.status === 'em_transito'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {item.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="font-bold text-slate-900 text-sm">{cli?.nomeRazao}</div>
                <div className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{obr?.nomeIdentificacao || 'Endereço da obra'}</span>
                </div>

                <div className="mt-3 bg-slate-50 p-2.5 rounded border border-slate-100 text-xs space-y-1">
                  <p className="text-slate-700">
                    <strong>Carga:</strong> {item.itensResumo}
                  </p>
                  <p className="text-slate-500 text-[11px]">
                    Motorista: <strong>{item.motorista}</strong> ({item.veiculoPlaca})
                  </p>
                  <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-200">
                    <span className="text-slate-500">
                      Data: {new Date(item.dataAgendada + 'T00:00:00').toLocaleDateString('pt-BR')} ({item.turno.toUpperCase()})
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      Frete: {formatCurrencyBRL(item.valorFrete)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-slate-100 flex justify-between items-center text-xs">
                <span className="text-[11px] text-slate-400 font-mono">Contr. {cnt?.numeroContrato}</span>
                {item.status !== 'concluido' && (
                  <button
                    onClick={() => atualizarLogisticaStatus(item.id, 'concluido')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
                  >
                    Marcar Concluído
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Agendamento */}
      {modalNovoAgendamentoOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-lg p-6">
            <h2 className="text-base font-black text-slate-900 uppercase mb-4">
              Agendar Rota de Logística
            </h2>

            <form onSubmit={handleSalvarAgendamento} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tipo de Operação</label>
                  <select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                  >
                    <option value="entrega">Entrega na Obra</option>
                    <option value="recolhimento">Recolhimento / Coleta na Obra</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Turno</label>
                  <select
                    value={turno}
                    onChange={(e) => setTurno(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                  >
                    <option value="manha">Manhã (07:30 às 12:00)</option>
                    <option value="tarde">Tarde (13:00 às 17:30)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Contrato Vinculado *</label>
                <select
                  value={contratoId}
                  onChange={(e) => setContratoId(e.target.value)}
                  required
                  className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                >
                  <option value="">Selecione o contrato...</option>
                  {contratos.map((c) => {
                    const cli = clientes.find((item) => item.id === c.clienteId);
                    return (
                      <option key={c.id} value={c.id}>
                        Nº {c.numeroContrato} — {cli?.nomeRazao}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Motorista</label>
                  <input
                    type="text"
                    value={motorista}
                    onChange={(e) => setMotorista(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Veículo / Placa</label>
                  <input
                    type="text"
                    value={veiculo}
                    onChange={(e) => setVeiculo(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Resumo dos Itens</label>
                <input
                  type="text"
                  value={itensResumo}
                  onChange={(e) => setItensResumo(e.target.value)}
                  placeholder="Ex: 40 painéis de andaime 1,50m e 20 plataformas"
                  className="w-full text-xs border border-slate-300 rounded p-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalNovoAgendamentoOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white text-xs font-bold rounded"
                >
                  Agendar Rota
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
