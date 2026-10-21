/**
 * Central Locação - Módulo de Clientes & Obras (PF e PJ)
 * Lynus Tecnologia
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Cliente, Obra, TipoPessoa } from '../types';
import { formatCurrencyBRL, isValidCPF, isValidCNPJ, formatCpfCnpj } from '../utils/billing';
import {
  Users,
  Plus,
  Search,
  Building2,
  Lock,
  Unlock,
  ShieldAlert,
  Phone,
  Mail,
  MapPin,
  Check,
} from 'lucide-react';

export const ClientesView: React.FC = () => {
  const { clientes, addCliente, updateCliente } = useApp();

  const [busca, setBusca] = useState('');
  const [modalNovoClienteOpen, setModalNovoClienteOpen] = useState(false);
  const [modalObraOpen, setModalObraOpen] = useState<string | null>(null);

  // Form de Novo Cliente
  const [tipo, setTipo] = useState<TipoPessoa>('PJ');
  const [nomeRazao, setNomeRazao] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [rgIe, setRgIe] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [diaCorte, setDiaCorte] = useState(20);
  const [limiteCredito, setLimiteCredito] = useState(15000);

  // Obra inicial do formulário
  const [obraNome, setObraNome] = useState('');
  const [obraLogradouro, setObraLogradouro] = useState('');
  const [obraNumero, setObraNumero] = useState('');
  const [obraBairro, setObraBairro] = useState('');
  const [obraCidade, setObraCidade] = useState('São José do Rio Preto');
  const [obraCep, setObraCep] = useState('');
  const [obraRespNome, setObraRespNome] = useState('');
  const [obraRespFone, setObraRespFone] = useState('');

  // Busca rápida de CEP simulada/funcional
  const handleBuscarCep = async (cep: string) => {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length === 8) {
      try {
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        const data = await res.json();
        if (!data.erro) {
          setObraLogradouro(data.logradouro || '');
          setObraBairro(data.bairro || '');
          setObraCidade(data.localidade || 'São José do Rio Preto');
        }
      } catch {
        // Silently fallback if offline
      }
    }
  };

  const handleSalvarCliente = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomeRazao || !cpfCnpj) return;

    const obras: Obra[] = obraNome
      ? [
          {
            id: `obr-${Date.now()}`,
            nomeIdentificacao: obraNome,
            logradouro: obraLogradouro || 'Endereço da Obra',
            numero: obraNumero || 's/n',
            bairro: obraBairro || 'Bairro',
            cidade: obraCidade,
            uf: 'SP',
            cep: obraCep || '15000-000',
            responsavelNome: obraRespNome || nomeRazao,
            responsavelTelefone: obraRespFone || telefone,
          },
        ]
      : [];

    addCliente({
      tipo,
      nomeRazao,
      cpfCnpj,
      rgIe,
      email,
      telefone,
      diaCorteFaturamento: diaCorte,
      limiteCredito,
      saldoDevedor: 0,
      bloqueado: false,
      obras,
    });

    setModalNovoClienteOpen(false);
    setNomeRazao('');
    setCpfCnpj('');
    setRgIe('');
    setEmail('');
    setTelefone('');
    setObraNome('');
  };

  const handleToggleBloqueio = (cliente: Cliente) => {
    const novoStatus = !cliente.bloqueado;
    const motivo = novoStatus
      ? prompt('Informe o motivo do bloqueio do cliente para novas locações:')
      : undefined;

    if (novoStatus && !motivo) return;

    updateCliente(cliente.id, {
      bloqueado: novoStatus,
      motivoBloqueio: motivo || undefined,
    });
  };

  const clientesFiltrados = clientes.filter(
    (c) =>
      c.nomeRazao.toLowerCase().includes(busca.toLowerCase()) ||
      c.cpfCnpj.includes(busca) ||
      c.telefone.includes(busca)
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-[#2AA3D8]" />
            Cadastro de Clientes & Obras (PF e PJ)
          </h1>
          <p className="text-xs text-slate-500">
            Gestão cadastral com validação fiscal, múltiplas obras por construtora, limite e bloqueio de inadimplentes.
          </p>
        </div>

        <button
          onClick={() => setModalNovoClienteOpen(true)}
          className="flex items-center gap-2 bg-[#2AA3D8] hover:bg-[#1e86b3] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Cadastrar Cliente
        </button>
      </div>

      {/* Busca */}
      <div className="bg-white p-3 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por razão social, nome, CNPJ/CPF..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-hidden"
          />
        </div>
      </div>

      {/* Grade de Clientes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clientesFiltrados.map((cli) => (
          <div
            key={cli.id}
            className={`bg-white rounded-xl border p-4 shadow-xs flex flex-col justify-between transition-all ${
              cli.bloqueado ? 'border-red-300 bg-red-50/20' : 'border-slate-200 hover:border-[#2AA3D8]'
            }`}
          >
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-slate-100 text-slate-700">
                  {cli.tipo === 'PJ' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                </span>
                <button
                  onClick={() => handleToggleBloqueio(cli)}
                  className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer ${
                    cli.bloqueado
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                  }`}
                  title={cli.bloqueado ? 'Clique para desbloquear' : 'Clique para bloquear'}
                >
                  {cli.bloqueado ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  {cli.bloqueado ? 'BLOQUEADO' : 'LIBERADO'}
                </button>
              </div>

              <h2 className="font-bold text-slate-900 text-sm">{cli.nomeRazao}</h2>
              <p className="font-mono text-xs text-slate-500 mt-0.5">{cli.cpfCnpj}</p>

              <div className="mt-3 space-y-1.5 text-xs text-slate-600 border-t border-slate-100 pt-2">
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{cli.telefone}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-slate-400" />
                  <span className="truncate">{cli.email}</span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-500 text-[11px]">Dia de Corte: Todo dia {cli.diaCorteFaturamento}</span>
                  <span className="font-mono font-bold text-slate-800 text-[11px]">
                    Limite: {formatCurrencyBRL(cli.limiteCredito)}
                  </span>
                </div>
              </div>

              {/* Obras Vinculadas */}
              <div className="mt-3 pt-2 border-t border-slate-100">
                <span className="text-[10.5px] font-bold uppercase text-slate-400 block mb-1">
                  Obras Cadastradas ({cli.obras.length}):
                </span>
                <div className="space-y-1">
                  {cli.obras.map((obr) => (
                    <div key={obr.id} className="text-[11px] bg-slate-50 p-1.5 rounded border border-slate-200/80">
                      <div className="font-semibold text-slate-800">{obr.nomeIdentificacao}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {obr.logradouro}, {obr.numero} - {obr.bairro} ({obr.cidade})
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {cli.bloqueado && (
              <div className="mt-3 p-2 bg-red-100 border border-red-200 rounded text-[10px] text-red-800 flex items-center gap-1.5 font-medium">
                <ShieldAlert className="w-4 h-4 shrink-0 text-red-600" />
                <span>{cli.motivoBloqueio || 'Bloqueado por inadimplência.'}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal Novo Cliente */}
      {modalNovoClienteOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-300 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-base font-black text-slate-900 uppercase mb-4">
              Cadastrar Novo Cliente
            </h2>

            <form onSubmit={handleSalvarCliente} className="space-y-4">
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                  <input
                    type="radio"
                    name="tipoCli"
                    checked={tipo === 'PJ'}
                    onChange={() => setTipo('PJ')}
                  />
                  <span>Pessoa Jurídica (CNPJ)</span>
                </label>
                <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                  <input
                    type="radio"
                    name="tipoCli"
                    checked={tipo === 'PF'}
                    onChange={() => setTipo('PF')}
                  />
                  <span>Pessoa Física (CPF)</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {tipo === 'PJ' ? 'Razão Social *' : 'Nome Completo *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={nomeRazao}
                    onChange={(e) => setNomeRazao(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {tipo === 'PJ' ? 'CNPJ *' : 'CPF *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={cpfCnpj}
                    onChange={(e) => setCpfCnpj(e.target.value)}
                    placeholder={tipo === 'PJ' ? '00.000.000/0001-00' : '000.000.000-00'}
                    className="w-full text-xs border border-slate-300 rounded p-2 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {tipo === 'PJ' ? 'Inscrição Estadual' : 'RG'}
                  </label>
                  <input
                    type="text"
                    value={rgIe}
                    onChange={(e) => setRgIe(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Telefone / WhatsApp *</label>
                  <input
                    type="text"
                    required
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(17) 99000-0000"
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">E-mail *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="compras@cliente.com.br"
                    className="w-full text-xs border border-slate-300 rounded p-2"
                  />
                </div>
              </div>

              {/* Endereço da Obra Inicial */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="block text-xs font-bold text-slate-800 uppercase mb-2">
                  Primeira Obra / Canteiro de Entrega
                </span>

                <div className="space-y-2">
                  <div>
                    <label className="block text-[11px] text-slate-600">Identificação da Obra *</label>
                    <input
                      type="text"
                      value={obraNome}
                      onChange={(e) => setObraNome(e.target.value)}
                      placeholder="Ex: Residencial Damha - Lote 12"
                      className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500">CEP</label>
                      <input
                        type="text"
                        value={obraCep}
                        onChange={(e) => {
                          setObraCep(e.target.value);
                          handleBuscarCep(e.target.value);
                        }}
                        placeholder="15000-000"
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white font-mono"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] text-slate-500">Logradouro / Rua</label>
                      <input
                        type="text"
                        value={obraLogradouro}
                        onChange={(e) => setObraLogradouro(e.target.value)}
                        placeholder="Av. Alberto Andaló"
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500">Número</label>
                      <input
                        type="text"
                        value={obraNumero}
                        onChange={(e) => setObraNumero(e.target.value)}
                        placeholder="1000"
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500">Bairro</label>
                      <input
                        type="text"
                        value={obraBairro}
                        onChange={(e) => setObraBairro(e.target.value)}
                        placeholder="Centro"
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500">Cidade</label>
                      <input
                        type="text"
                        value={obraCidade}
                        onChange={(e) => setObraCidade(e.target.value)}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalNovoClienteOpen(false)}
                  className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white text-xs font-bold rounded"
                >
                  Salvar Cliente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
