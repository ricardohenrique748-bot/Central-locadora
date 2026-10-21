/**
 * Central Locação - Módulo de Contratos & Orçamentos
 * Lynus Tecnologia
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Contrato, ContratoItem, PeriodoLocacao } from '../types';
import { formatCurrencyBRL } from '../utils/billing';
import {
  FileText,
  Plus,
  Printer,
  FileCheck,
  Search,
  AlertCircle,
  Building2,
  Trash2,
  ArrowRight,
  ShieldAlert,
  FilePlus,
} from 'lucide-react';

interface ContratosViewProps {
  onSelectContratoPrint: (contrato: Contrato) => void;
  isCreateModalOpen?: boolean;
  setIsCreateModalOpen?: (open: boolean) => void;
}

export const ContratosView: React.FC<ContratosViewProps> = ({
  onSelectContratoPrint,
  isCreateModalOpen: externalModalOpen,
  setIsCreateModalOpen: setExternalModalOpen,
}) => {
  const {
    contratos,
    clientes,
    equipamentos,
    patrimonios,
    estoqueGranel,
    criarContrato,
    converterOrcamentoParaContrato,
    adicionarItensAoContrato,
  } = useApp();

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const [modalAditivoOpen, setModalAditivoOpen] = useState<string | null>(null);

  const isModalOpen = externalModalOpen !== undefined ? externalModalOpen : internalModalOpen;
  const setModalOpen = setExternalModalOpen || setInternalModalOpen;

  // Form de Novo Contrato
  const [clienteId, setClienteId] = useState('');
  const [obraId, setObraId] = useState('');
  const [modalidadeTransporte, setModalidadeTransporte] = useState<'entrega_locadora' | 'retirada_balcao'>('entrega_locadora');
  const [freteEntrega, setFreteEntrega] = useState(100);
  const [freteRecolhimento, setFreteRecolhimento] = useState(100);
  const [tipoDocumento, setTipoDocumento] = useState<'ativo' | 'orcamento'>('ativo');
  const [itensForm, setItensForm] = useState<
    Array<{
      equipamentoId: string;
      quantidade: number;
      periodoTipo: PeriodoLocacao;
      valorUnitario: number;
      dataInicio: string;
      patrimonioId?: string;
    }>
  >([]);

  // Item selecionado para adicionar ao form
  const [novoEquipId, setNovoEquipId] = useState('');
  const [novaQtde, setNovaQtde] = useState(1);
  const [novoPeriodo, setNovoPeriodo] = useState<PeriodoLocacao>('mensal');
  const [novoPatrimonioId, setNovoPatrimonioId] = useState('');

  // Form de Aditivo
  const [aditivoMotivo, setAditivoMotivo] = useState('');
  const [aditivoEquipId, setAditivoEquipId] = useState('');
  const [aditivoQtde, setAditivoQtde] = useState(1);
  const [aditivoPeriodo, setAditivoPeriodo] = useState<PeriodoLocacao>('mensal');

  const clienteSelecionado = clientes.find((c) => c.id === clienteId);
  const obrasDoCliente = clienteSelecionado?.obras || [];

  // Filtragem
  const contratosFiltrados = contratos.filter((c) => {
    const cli = clientes.find((item) => item.id === c.clienteId);
    const matchBusca =
      c.numeroContrato.includes(busca) ||
      cli?.nomeRazao.toLowerCase().includes(busca.toLowerCase());
    const matchStatus = filtroStatus === 'todos' || c.status === filtroStatus;
    return matchBusca && matchStatus;
  });

  const handleAddItemToForm = () => {
    const equip = equipamentos.find((e) => e.id === novoEquipId);
    if (!equip) return;

    let valorUnit = equip.valorMensal;
    if (novoPeriodo === 'diaria') valorUnit = equip.valorDiaria;
    if (novoPeriodo === 'semanal') valorUnit = equip.valorSemanal;
    if (novoPeriodo === 'quinzenal') valorUnit = equip.valorQuinzenal;

    // Verificar saldo se for granel
    if (equip.tipoControle === 'granel') {
      const saldo = estoqueGranel.find((eg) => eg.equipamentoId === equip.id);
      if (saldo && saldo.disponivel < novaQtde) {
        alert(`Saldo insuficiente no estoque! Disponível: ${saldo.disponivel} un/pç.`);
        return;
      }
    }

    setItensForm((prev) => [
      ...prev,
      {
        equipamentoId: equip.id,
        quantidade: novaQtde,
        periodoTipo: novoPeriodo,
        valorUnitario: valorUnit,
        dataInicio: new Date().toISOString().split('T')[0],
        patrimonioId: novoPatrimonioId || undefined,
      },
    ]);

    setNovoEquipId('');
    setNovaQtde(1);
    setNovoPatrimonioId('');
  };

  const handleSalvarContrato = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clienteId) {
      alert('Selecione um cliente.');
      return;
    }

    if (clienteSelecionado?.bloqueado) {
      alert(`CLIENTE BLOQUEADO: ${clienteSelecionado.motivoBloqueio || 'Inadimplente'}. Desbloqueie o cliente antes de locar.`);
      return;
    }

    if (itensForm.length === 0) {
      alert('Adicione pelo menos um item ao contrato.');
      return;
    }

    const dataHoje = new Date().toISOString().split('T')[0];

    const contratoItens: ContratoItem[] = itensForm.map((it, idx) => {
      const eq = equipamentos.find((e) => e.id === it.equipamentoId);
      return {
        id: `cni-new-${Date.now()}-${idx}`,
        equipamentoId: it.equipamentoId,
        quantidade: it.quantidade,
        valorUnitarioPeriodo: it.valorUnitario,
        periodoTipo: it.periodoTipo,
        dataInicio: it.dataInicio,
        dataProximaRenovacao: dataHoje,
        quantidadeDevolvida: 0,
        status: 'ativo',
        patrimonioIds: it.patrimonioId ? [it.patrimonioId] : undefined,
        valorIndenizacaoUnitario: eq?.valorReposicaoIndenizacao || 100,
      };
    });

    const totalMensal = contratoItens.reduce(
      (acc, it) => acc + it.valorUnitarioPeriodo * it.quantidade,
      0
    );

    const novo = criarContrato({
      dataEmissao: dataHoje,
      clienteId,
      obraId: obraId || (obrasDoCliente[0]?.id || ''),
      status: tipoDocumento,
      itens: contratoItens,
      freteEntrega: modalidadeTransporte === 'entrega_locadora' ? freteEntrega : 0,
      freteRecolhimento: modalidadeTransporte === 'entrega_locadora' ? freteRecolhimento : 0,
      modalidadeTransporte,
      totalMensalEstimado: totalMensal,
      responsavelLocadora: 'Balcão Central Locações',
      responsavelLocatarioNome: clienteSelecionado?.nomeRazao,
    });

    setModalOpen(false);
    setItensForm([]);
    onSelectContratoPrint(novo);
  };

  const handleSalvarAditivo = (contratoId: string) => {
    const eq = equipamentos.find((e) => e.id === aditivoEquipId);
    if (!eq) return;

    let valorUnit = eq.valorMensal;
    if (aditivoPeriodo === 'diaria') valorUnit = eq.valorDiaria;
    if (aditivoPeriodo === 'semanal') valorUnit = eq.valorSemanal;
    if (aditivoPeriodo === 'quinzenal') valorUnit = eq.valorQuinzenal;

    const novoItem: ContratoItem = {
      id: `cni-adt-${Date.now()}`,
      equipamentoId: eq.id,
      quantidade: aditivoQtde,
      valorUnitarioPeriodo: valorUnit,
      periodoTipo: aditivoPeriodo,
      dataInicio: new Date().toISOString().split('T')[0],
      dataProximaRenovacao: new Date().toISOString().split('T')[0],
      quantidadeDevolvida: 0,
      status: 'ativo',
      valorIndenizacaoUnitario: eq.valorReposicaoIndenizacao,
    };

    adicionarItensAoContrato(
      contratoId,
      [novoItem],
      aditivoMotivo || 'Aditivo de acréscimo de equipamentos à obra'
    );

    setModalAditivoOpen(null);
    setAditivoMotivo('');
    setAditivoEquipId('');
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#2AA3D8]" />
            Contratos de Locação & Orçamentos
          </h1>
          <p className="text-xs text-slate-500">
            Contratos com numeração sequencial, múltiplos itens e ciclos independentes de 30 dias.
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 bg-[#2AA3D8] hover:bg-[#1f87b3] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Novo Contrato / Orçamento
        </button>
      </div>

      {/* Filtros e Busca */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nº contrato ou cliente..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs text-slate-500 font-semibold">Status:</span>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white text-slate-800 focus:outline-hidden"
          >
            <option value="todos">Todos os Contratos</option>
            <option value="ativo">Ativos</option>
            <option value="orcamento">Orçamentos</option>
            <option value="encerrado">Encerrados</option>
          </select>
        </div>
      </div>

      {/* Tabela de Contratos */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-left font-bold uppercase text-[10.5px]">
              <th className="p-3 w-28">Nº Contrato</th>
              <th className="p-3">Cliente / Razão Social</th>
              <th className="p-3">Obra / Endereço</th>
              <th className="p-3 text-center">Itens</th>
              <th className="p-3 text-right">Mensal Estimado</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contratosFiltrados.map((cnt) => {
              const cliente = clientes.find((c) => c.id === cnt.clienteId);
              const obra = cliente?.obras.find((o) => o.id === cnt.obraId);

              return (
                <tr key={cnt.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-mono font-bold text-[#D9332B] text-sm">
                    {cnt.numeroContrato}
                  </td>
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{cliente?.nomeRazao}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{cliente?.cpfCnpj}</div>
                  </td>
                  <td className="p-3 text-slate-600">
                    <div className="font-medium text-slate-800">{obra?.nomeIdentificacao || 'Obra Cadastrada'}</div>
                    <div className="text-[10px] text-slate-400">{obra?.cidade}/{obra?.uf}</div>
                  </td>
                  <td className="p-3 text-center">
                    <span className="font-mono bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-700">
                      {cnt.itens.length} {cnt.itens.length === 1 ? 'item' : 'itens'}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono font-bold text-slate-900">
                    {formatCurrencyBRL(cnt.totalMensalEstimado)}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        cnt.status === 'ativo'
                          ? 'bg-emerald-100 text-emerald-800'
                          : cnt.status === 'orcamento'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {cnt.status}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    {cnt.status === 'orcamento' && (
                      <button
                        onClick={() => converterOrcamentoParaContrato(cnt.id)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded text-[11px] font-bold shadow-2xs transition-colors cursor-pointer"
                        title="Converter Orçamento em Contrato Ativo"
                      >
                        Ativar Contrato
                      </button>
                    )}

                    {cnt.status === 'ativo' && (
                      <button
                        onClick={() => setModalAditivoOpen(cnt.id)}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-2.5 py-1 rounded text-[11px] font-bold border border-slate-300 transition-colors cursor-pointer"
                        title="Adicionar Itens ao Contrato (Aditivo)"
                      >
                        + Aditivo
                      </button>
                    )}

                    <button
                      onClick={() => onSelectContratoPrint(cnt)}
                      className="bg-[#2AA3D8] hover:bg-[#1a85b3] text-white px-2.5 py-1 rounded text-[11px] font-bold inline-flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                      title="Visualizar e Imprimir Contrato Oficial (Item 3.1)"
                    >
                      <Printer className="w-3.5 h-3.5" /> Imprimir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal Criar Contrato / Orçamento */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center pb-3 mb-4 border-b border-slate-200">
              <h2 className="text-base font-black text-slate-900 uppercase">
                Novo Contrato de Locação / Orçamento
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSalvarContrato} className="space-y-4">
              {/* Tipo de Documento */}
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-slate-700">Tipo de Documento:</span>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer font-medium">
                  <input
                    type="radio"
                    name="tipoDoc"
                    checked={tipoDocumento === 'ativo'}
                    onChange={() => setTipoDocumento('ativo')}
                  />
                  <span>Contrato Ativo (reserva estoque e entrega imediata)</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer font-medium">
                  <input
                    type="radio"
                    name="tipoDoc"
                    checked={tipoDocumento === 'orcamento'}
                    onChange={() => setTipoDocumento('orcamento')}
                  />
                  <span>Orçamento (não debita estoque)</span>
                </label>
              </div>

              {/* Cliente e Obra */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Cliente / Locatário *</label>
                  <select
                    value={clienteId}
                    onChange={(e) => {
                      setClienteId(e.target.value);
                      const cli = clientes.find((c) => c.id === e.target.value);
                      if (cli && cli.obras.length > 0) setObraId(cli.obras[0].id);
                    }}
                    required
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                  >
                    <option value="">Selecione o Cliente...</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nomeRazao} ({c.cpfCnpj}) {c.bloqueado ? ' [BLOQUEADO INADIMPLENTE]' : ''}
                      </option>
                    ))}
                  </select>

                  {clienteSelecionado?.bloqueado && (
                    <div className="mt-1 text-[11px] text-red-600 font-bold flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" /> Este cliente possui pendências e está bloqueado.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Obra de Utilização Exclusiva *</label>
                  <select
                    value={obraId}
                    onChange={(e) => setObraId(e.target.value)}
                    required
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                  >
                    {obrasDoCliente.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nomeIdentificacao} — {o.bairro}, {o.cidade}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Transporte e Frete */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Modalidade Transporte</label>
                  <select
                    value={modalidadeTransporte}
                    onChange={(e) => setModalidadeTransporte(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white"
                  >
                    <option value="entrega_locadora">Entrega na Obra pela Locadora</option>
                    <option value="retirada_balcao">Cliente Retira no Balcão</option>
                  </select>
                </div>

                {modalidadeTransporte === 'entrega_locadora' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Frete de Entrega (R$)</label>
                      <input
                        type="number"
                        value={freteEntrega}
                        onChange={(e) => setFreteEntrega(Number(e.target.value))}
                        className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Frete de Recolhimento (R$)</label>
                      <input
                        type="number"
                        value={freteRecolhimento}
                        onChange={(e) => setFreteRecolhimento(Number(e.target.value))}
                        className="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-mono"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Adicionar Itens ao Contrato */}
              <div className="border border-slate-200 p-3 rounded-lg">
                <h3 className="text-xs font-bold text-slate-800 uppercase mb-2">
                  Adicionar Equipamento ao Contrato
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-slate-500">Equipamento</label>
                    <select
                      value={novoEquipId}
                      onChange={(e) => setNovoEquipId(e.target.value)}
                      className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                    >
                      <option value="">Selecione o equipamento...</option>
                      {equipamentos.map((eq) => {
                        const saldo = estoqueGranel.find((eg) => eg.equipamentoId === eq.id);
                        return (
                          <option key={eq.id} value={eq.id}>
                            [{eq.codigo}] {eq.nome} {saldo ? `(Disp: ${saldo.disponivel})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-500">Qtde</label>
                    <input
                      type="number"
                      min={1}
                      value={novaQtde}
                      onChange={(e) => setNovaQtde(Number(e.target.value))}
                      className="w-full text-xs border border-slate-300 rounded p-1.5"
                    />
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={handleAddItemToForm}
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs p-2 rounded transition-colors"
                    >
                      + Inserir Item
                    </button>
                  </div>
                </div>

                {/* Lista de Itens no Form */}
                {itensForm.length > 0 && (
                  <div className="mt-3 border-t border-slate-200 pt-2 space-y-1">
                    {itensForm.map((item, idx) => {
                      const eq = equipamentos.find((e) => e.id === item.equipamentoId);
                      return (
                        <div
                          key={idx}
                          className="flex justify-between items-center text-xs bg-slate-50 p-2 rounded border border-slate-200"
                        >
                          <div>
                            <span className="font-bold text-slate-900">{item.quantidade}x</span>{' '}
                            <span className="text-slate-700">{eq?.nome}</span> (Ciclo {item.periodoTipo})
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-slate-900">
                              {formatCurrencyBRL(item.valorUnitario * item.quantidade)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setItensForm(itensForm.filter((_, i) => i !== idx))}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Botões do Modal */}
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
                  disabled={clienteSelecionado?.bloqueado}
                  className="px-5 py-2 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50"
                >
                  Gerar e Imprimir Contrato
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Aditivo de Contrato */}
      {modalAditivoOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-lg p-6">
            <h2 className="text-base font-black text-slate-900 uppercase mb-3">
              Termo Aditivo ao Contrato
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Inclusão de novos equipamentos ou alteração de escopo na obra com início de ciclo próprio.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Motivo do Aditivo</label>
                <input
                  type="text"
                  value={aditivoMotivo}
                  onChange={(e) => setAditivoMotivo(e.target.value)}
                  placeholder="Ex: Reforço de andaimes para torre oeste"
                  className="w-full text-xs border border-slate-300 rounded p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Equipamento a Incluir</label>
                <select
                  value={aditivoEquipId}
                  onChange={(e) => setAditivoEquipId(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                >
                  <option value="">Selecione o equipamento...</option>
                  {equipamentos.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      [{eq.codigo}] {eq.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Quantidade</label>
                  <input
                    type="number"
                    min={1}
                    value={aditivoQtde}
                    onChange={(e) => setAditivoQtde(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Período</label>
                  <select
                    value={aditivoPeriodo}
                    onChange={(e) => setAditivoPeriodo(e.target.value as any)}
                    className="w-full text-xs border border-slate-300 rounded p-2 bg-white"
                  >
                    <option value="mensal">Mensal</option>
                    <option value="quinzenal">Quinzenal</option>
                    <option value="semanal">Semanal</option>
                    <option value="diaria">Diária</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalAditivoOpen(null)}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSalvarAditivo(modalAditivoOpen)}
                  className="px-4 py-1.5 bg-[#2AA3D8] text-white text-xs font-bold rounded"
                >
                  Registrar Aditivo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
