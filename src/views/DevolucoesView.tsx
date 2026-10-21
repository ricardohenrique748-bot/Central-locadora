/**
 * Central Locação - Módulo de Devoluções & Checklist de Vistoria
 * Lynus Tecnologia
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  ComprovanteDevolucao,
  ItemDevolvidoChecklist,
  CondicaoItemDevolucao,
} from '../types';
import { formatCurrencyBRL } from '../utils/billing';
import { SignaturePad } from '../components/SignaturePad';
import {
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  XCircle,
  Printer,
  Plus,
  Camera,
  FileCheck2,
} from 'lucide-react';

interface DevolucoesViewProps {
  onSelectDevolucaoPrint: (dev: ComprovanteDevolucao) => void;
  isCreateModalOpen?: boolean;
  setIsCreateModalOpen?: (open: boolean) => void;
}

export const DevolucoesView: React.FC<DevolucoesViewProps> = ({
  onSelectDevolucaoPrint,
  isCreateModalOpen: externalModalOpen,
  setIsCreateModalOpen: setExternalModalOpen,
}) => {
  const {
    contratos,
    clientes,
    equipamentos,
    comprovantesDevolucao,
    registrarDevolucao,
    configEmpresa,
  } = useApp();

  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const isModalOpen = externalModalOpen !== undefined ? externalModalOpen : internalModalOpen;
  const setModalOpen = setExternalModalOpen || setInternalModalOpen;

  // Form State
  const [contratoId, setContratoId] = useState('');
  const [localEntrega, setLocalEntrega] = useState<'balcao' | 'obra'>('balcao');
  const [itensDevolucao, setItensDevolucao] = useState<
    Array<{
      itemId: string;
      equipamentoId: string;
      descricao: string;
      quantidadeDisponivelParaDevolver: number;
      quantidadeDevolver: number;
      patrimonioId?: string;
      condicao: CondicaoItemDevolucao;
      observacao: string;
      valorCobrancaAvaria: number;
    }>
  >([]);

  // Assinaturas
  const [recebedorNome, setRecebedorNome] = useState('');
  const [recebedorRg, setRecebedorRg] = useState('');
  const [recebedorFone, setRecebedorFone] = useState('');
  const [recebedorAssinatura, setRecebedorAssinatura] = useState('');

  const contratoSelecionado = contratos.find((c) => c.id === contratoId);
  const clienteSelecionado = clientes.find((c) => c.id === contratoSelecionado?.clienteId);

  const handleSelectContrato = (cId: string) => {
    setContratoId(cId);
    const cnt = contratos.find((c) => c.id === cId);
    if (!cnt) return;

    const itensMapeados = cnt.itens
      .filter((it) => it.status !== 'devolvido_total')
      .map((it) => {
        const eq = equipamentos.find((e) => e.id === it.equipamentoId);
        const qtdeRestante = it.quantidade - it.quantidadeDevolvida;
        return {
          itemId: it.id,
          equipamentoId: it.equipamentoId,
          descricao: eq?.nome || 'Equipamento',
          quantidadeDisponivelParaDevolver: qtdeRestante,
          quantidadeDevolver: qtdeRestante, // Default: devolver o restante
          patrimonioId: it.patrimonioIds?.[0],
          condicao: 'conforme' as CondicaoItemDevolucao,
          observacao: 'Conferido no ato da entrega',
          valorCobrancaAvaria: 0,
        };
      });

    setItensDevolucao(itensMapeados);
    setRecebedorNome(cnt.responsavelLocatarioNome || clienteSelecionado?.nomeRazao || '');
  };

  const handleFinalizarDevolucao = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contratoSelecionado || !clienteSelecionado) {
      alert('Selecione um contrato válido.');
      return;
    }

    const itensParaDevolver = itensDevolucao.filter((it) => it.quantidadeDevolver > 0);
    if (itensParaDevolver.length === 0) {
      alert('Informe a quantidade de itens a devolver.');
      return;
    }

    const totalAvarias = itensParaDevolver.reduce(
      (acc, it) => acc + (it.valorCobrancaAvaria || 0),
      0
    );

    const dataHoraAtual = new Date().toISOString().replace('T', ' ').substring(0, 16);

    const novoComprovante = registrarDevolucao({
      contratoId: contratoSelecionado.id,
      clienteId: clienteSelecionado.id,
      obraId: contratoSelecionado.obraId,
      dataHora: dataHoraAtual,
      localEntrega,
      itens: itensParaDevolver.map((it) => ({
        itemId: it.itemId,
        equipamentoId: it.equipamentoId,
        descricao: it.descricao,
        quantidadeDevolvida: it.quantidadeDevolver,
        patrimonioId: it.patrimonioId,
        condicao: it.condicao,
        observacao: it.observacao,
        valorCobrancaAvaria: it.valorCobrancaAvaria,
      })),
      totalCobrancasAvarias: totalAvarias,
      assinaturaRecebedor: {
        nome: recebedorNome || 'Devolvente / Locatário',
        rg: recebedorRg,
        telefone: recebedorFone,
        assinaturaDataUrl: recebedorAssinatura,
      },
      assinaturaLocadora: {
        nome: 'Valdir - Conferência de Pátio',
        assinaturaDataUrl: '',
      },
      cidade: 'São José do Rio Preto - SP',
    });

    setModalOpen(false);
    onSelectDevolucaoPrint(novoComprovante);
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-[#2AA3D8]" />
            Comprovantes de Devolução & Checklist de Pátio
          </h1>
          <p className="text-xs text-slate-500">
            Checklist de vistoria com avaliação física/funcional, cobrança automática de avarias e assinatura na tela.
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 bg-[#D9332B] hover:bg-[#b52620] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Registrar Devolução / Checklist
        </button>
      </div>

      {/* Lista de Comprovantes de Devolução Anteriores */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-left font-bold uppercase text-[10.5px]">
              <th className="p-3 w-32">Nº Comprovante</th>
              <th className="p-3">Data / Hora</th>
              <th className="p-3">Contrato Ref.</th>
              <th className="p-3">Cliente / Devolvente</th>
              <th className="p-3 text-center">Itens Recebidos</th>
              <th className="p-3 text-right">Cobrança Avarias</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {comprovantesDevolucao.map((dev) => {
              const cli = clientes.find((c) => c.id === dev.clienteId);
              const cnt = contratos.find((c) => c.id === dev.contratoId);

              return (
                <tr key={dev.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-mono font-bold text-[#2AA3D8] text-sm">
                    {dev.numeroComprovante}
                  </td>
                  <td className="p-3 text-slate-600 font-mono text-[11px]">
                    {dev.dataHora}
                  </td>
                  <td className="p-3 font-mono font-bold text-[#D9332B]">
                    Nº {cnt?.numeroContrato || 'N/A'}
                  </td>
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{cli?.nomeRazao}</div>
                    <div className="text-[10px] text-slate-400">Recebedor: {dev.assinaturaRecebedor.nome}</div>
                  </td>
                  <td className="p-3 text-center">
                    <span className="font-mono bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-700">
                      {dev.itens.reduce((acc, it) => acc + it.quantidadeDevolvida, 0)} un/pçs
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono font-bold">
                    {dev.totalCobrancasAvarias > 0 ? (
                      <span className="text-red-600">
                        {formatCurrencyBRL(dev.totalCobrancasAvarias)}
                      </span>
                    ) : (
                      <span className="text-emerald-700">R$ 0,00</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => onSelectDevolucaoPrint(dev)}
                      className="bg-slate-800 hover:bg-slate-900 text-white px-2.5 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" /> Ver / Imprimir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal de Registro de Devolução */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center pb-3 mb-4 border-b border-slate-200">
              <h2 className="text-base font-black text-slate-900 uppercase">
                Checklist e Devolução de Equipamentos
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFinalizarDevolucao} className="space-y-4">
              {/* Seleção do Contrato Ativo */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Selecione o Contrato Ativo *
                  </label>
                  <select
                    value={contratoId}
                    onChange={(e) => handleSelectContrato(e.target.value)}
                    required
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                  >
                    <option value="">Selecione o contrato...</option>
                    {contratos
                      .filter((c) => c.status === 'ativo')
                      .map((c) => {
                        const cli = clientes.find((item) => item.id === c.clienteId);
                        return (
                          <option key={c.id} value={c.id}>
                            Contrato {c.numeroContrato} — {cli?.nomeRazao}
                          </option>
                        );
                      })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Local de Recebimento
                  </label>
                  <select
                    value={localEntrega}
                    onChange={(e) => setLocalEntrega(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                  >
                    <option value="balcao">Devolução no Balcão da Locadora</option>
                    <option value="obra">Coletado na Obra pelo Caminhão</option>
                  </select>
                </div>
              </div>

              {/* Itens do Contrato para Vistoria */}
              {itensDevolucao.length > 0 && (
                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                  <h3 className="text-xs font-bold text-slate-800 uppercase mb-2">
                    Vistoria dos Itens a Devolver (Checklist 3.2):
                  </h3>

                  <div className="space-y-3">
                    {itensDevolucao.map((it, idx) => {
                      const equip = equipamentos.find((e) => e.id === it.equipamentoId);
                      return (
                        <div
                          key={idx}
                          className="bg-white p-3 rounded border border-slate-200 space-y-2 text-xs"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <span className="font-bold text-slate-900">{it.descricao}</span>
                              {it.patrimonioId && (
                                <span className="ml-2 font-mono text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">
                                  {it.patrimonioId}
                                </span>
                              )}
                              <span className="text-slate-400 text-[11px] ml-2">
                                (Pendente: {it.quantidadeDisponivelParaDevolver} {equip?.unidadeMedida || 'pç'})
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-slate-600">Devolver agora:</span>
                              <input
                                type="number"
                                min={0}
                                max={it.quantidadeDisponivelParaDevolver}
                                value={it.quantidadeDevolver}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setItensDevolucao((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, quantidadeDevolver: val } : item
                                    )
                                  );
                                }}
                                className="w-16 border border-slate-300 rounded p-1 text-center font-bold"
                              />
                            </div>
                          </div>

                          {/* Seletor de Condição */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                            {[
                              { id: 'conforme', label: 'Conforme', color: 'emerald' },
                              { id: 'danificado_sujo', label: 'Danificado / Sujo', color: 'amber' },
                              { id: 'testar_na_empresa', label: 'Testar na Empresa', color: 'blue' },
                              { id: 'extraviado_roubado', label: 'Extraviado / Roubado', color: 'red' },
                            ].map((opt) => (
                              <label
                                key={opt.id}
                                className={`flex items-center gap-1.5 p-1.5 rounded border text-[10px] font-semibold cursor-pointer ${
                                  it.condicao === opt.id
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-700 border-slate-200'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`condicao-${idx}`}
                                  checked={it.condicao === opt.id}
                                  onChange={() => {
                                    let valorCobrar = 0;
                                    if (opt.id === 'extraviado_roubado') {
                                      valorCobrar = (equip?.valorReposicaoIndenizacao || 100) * it.quantidadeDevolver;
                                    } else if (opt.id === 'danificado_sujo') {
                                      valorCobrar = 50 * it.quantidadeDevolver; // taxa padrão de avaria/limpeza
                                    }
                                    setItensDevolucao((prev) =>
                                      prev.map((item, i) =>
                                        i === idx
                                          ? {
                                              ...item,
                                              condicao: opt.id as CondicaoItemDevolucao,
                                              valorCobrancaAvaria: valorCobrar,
                                            }
                                          : item
                                      )
                                    );
                                  }}
                                />
                                <span>{opt.label}</span>
                              </label>
                            ))}
                          </div>

                          {/* Observação e Cobrança se houver avaria */}
                          {(it.condicao === 'danificado_sujo' || it.condicao === 'extraviado_roubado') && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 bg-red-50/50 p-2 rounded border border-red-200">
                              <div>
                                <label className="block text-[10px] font-bold text-red-900">
                                  Detalhe da Avaria / Falta *
                                </label>
                                <input
                                  type="text"
                                  value={it.observacao}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setItensDevolucao((prev) =>
                                      prev.map((item, i) => (i === idx ? { ...item, observacao: v } : item))
                                    );
                                  }}
                                  placeholder="Ex: Peça torta com concreto grudado"
                                  className="w-full text-xs border border-red-300 rounded p-1 bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-red-900">
                                  Valor a Cobrar em Fatura (R$)
                                </label>
                                <input
                                  type="number"
                                  value={it.valorCobrancaAvaria}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setItensDevolucao((prev) =>
                                      prev.map((item, i) =>
                                        i === idx ? { ...item, valorCobrancaAvaria: val } : item
                                      )
                                    );
                                  }}
                                  className="w-full text-xs border border-red-300 rounded p-1 font-mono font-bold bg-white"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dados do Recebedor e Assinatura Digital Touch */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      Nome Legível do Devolvente / Responsável *
                    </label>
                    <input
                      type="text"
                      value={recebedorNome}
                      onChange={(e) => setRecebedorNome(e.target.value)}
                      required
                      placeholder="Ex: Fernando Albuquerque"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">RG / CPF</label>
                    <input
                      type="text"
                      value={recebedorRg}
                      onChange={(e) => setRecebedorRg(e.target.value)}
                      placeholder="Ex: 38.992.114-5 SSP/SP"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">Telefone</label>
                    <input
                      type="text"
                      value={recebedorFone}
                      onChange={(e) => setRecebedorFone(e.target.value)}
                      placeholder="Ex: (17) 99123-4567"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Assinatura Digital em Tela (Touch / Mouse)
                  </label>
                  <SignaturePad
                    signerName={recebedorNome}
                    onSave={(dataUrl) => setRecebedorAssinatura(dataUrl)}
                  />
                </div>
              </div>

              {/* Ações */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#D9332B] hover:bg-[#b82720] text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  Finalizar e Emitir Comprovante
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
