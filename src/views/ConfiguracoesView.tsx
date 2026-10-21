/**
 * Central Locação - Módulo de Configurações, Parâmetros de Negócio, Gestão de Usuários & Migrador i3tech
 * Lynus Tecnologia
 */

import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { AcessoAbas } from '../components/AcessoAbas';
import {
  Settings,
  Database,
  UploadCloud,
  CheckCircle2,
  Building,
  RotateCcw,
  Save,
  Users,
  UserPlus,
  ShieldAlert,
  Search,
  Pencil,
  Eye,
  EyeOff,
  UserCheck,
  UserX,
  X,
  KeyRound,
  CircleSlash,
  Sliders,
  Check,
} from 'lucide-react';
import { api, ApiError } from '../modules/orcamentos/api';
import { Role, ROLE_LABELS } from '../../shared/orcamentos/types';
import { formatDateBR } from '../../shared/orcamentos/dates';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  created_at: string;
}

const ROLE_BADGE_STYLES: Record<Role, string> = {
  admin: 'bg-purple-100 text-purple-800 border-purple-200',
  gestor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  vendedor: 'bg-sky-100 text-sky-800 border-sky-200',
  estoquista: 'bg-amber-100 text-amber-800 border-amber-200',
  financeiro: 'bg-teal-100 text-teal-800 border-teal-200',
  tecnico: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  consulta: 'bg-slate-100 text-slate-700 border-slate-200',
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Acesso total: gerencia usuários, alçadas, cadastros gerais e parâmetros de todo o ERP.',
  gestor: 'Aprovações de propostas e compras, gestão do catálogo, estoque e relatórios executivos.',
  vendedor: 'Criação e acompanhamento de orçamentos e propostas comerciais.',
  estoquista: 'Controle de saldos, movimentações, conferências de entrega e devoluções físicas.',
  financeiro: 'Contas a pagar e receber, fluxo de caixa, conciliação bancária e tesouraria.',
  tecnico: 'Ordens de serviço, manutenções preventivas, corretivas e checklists de equipamentos.',
  consulta: 'Acesso somente para leitura e visualização de dados e relatórios.',
};

export const ConfiguracoesView: React.FC = () => {
  const { configEmpresa, atualizarConfigEmpresa, importarDadosI3tech, resetarParaDadosPadrao, authUser, usuarioAtual } = useApp();

  const isAdmin = authUser?.role === 'admin' || usuarioAtual?.perfil === 'admin';

  const [activeTab, setActiveTab] = useState<'parametros' | 'usuarios' | 'migrador'>('parametros');

  // Parâmetros de negócio
  const [politicaDevolucao, setPoliticaDevolucao] = useState(configEmpresa.politicaDevolucao);
  const [diaCortePadrao, setDiaCortePadrao] = useState(configEmpresa.diaCortePadrao);
  const [chavePix, setChavePix] = useState(configEmpresa.chavePix);
  const [multaAtraso, setMultaAtraso] = useState(configEmpresa.multaAtrasoPercent);
  const [multaContratual, setMultaContratual] = useState(configEmpresa.multaContratualPercent);
  const [proximoContrato, setProximoContrato] = useState(configEmpresa.proximoNumeroContrato);
  const [proximaFatura, setProximaFatura] = useState(configEmpresa.proximoNumeroFatura);

  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [salvoFeedback, setSalvoFeedback] = useState(false);

  // Gestão de Usuários
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [searchUser, setSearchUser] = useState('');
  const [filterRole, setFilterRole] = useState<string>('todos');
  const [filterStatus, setFilterStatus] = useState<string>('todos');

  // Modais de Usuário
  const [modalNovoOpen, setModalNovoOpen] = useState(false);
  const [modalEditOpen, setModalEditOpen] = useState<UserRow | null>(null);

  // Form Novo Usuário
  const [novoNome, setNovoNome] = useState('');
  const [novoEmail, setNovoEmail] = useState('');
  const [novoRole, setNovoRole] = useState<Role>('vendedor');
  const [novaSenha, setNovaSenha] = useState('');
  const [novaSenhaConfirm, setNovaSenhaConfirm] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvandoNovo, setSalvandoNovo] = useState(false);
  const [erroNovo, setErroNovo] = useState<string | null>(null);
  const [feedbackUsuario, setFeedbackUsuario] = useState<string | null>(null);

  // Form Editar Usuário
  const [editNome, setEditNome] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<Role>('vendedor');
  const [editActive, setEditActive] = useState(true);
  const [editSenha, setEditSenha] = useState('');
  const [editSenhaConfirm, setEditSenhaConfirm] = useState('');
  const [mostrarEditSenha, setMostrarEditSenha] = useState(false);
  const [salvandoEdit, setSalvandoEdit] = useState(false);
  const [erroEdit, setErroEdit] = useState<string | null>(null);

  const carregarUsuarios = async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const res = await api.get<{ rows: UserRow[] }>('/users');
      setUsers(res.rows);
    } catch (err) {
      setUsersError((err as Error).message || 'Erro ao carregar usuários.');
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      carregarUsuarios();
    }
  }, [isAdmin]);

  const handleSalvarConfig = (e: React.FormEvent) => {
    e.preventDefault();
    atualizarConfigEmpresa({
      politicaDevolucao,
      diaCortePadrao,
      chavePix,
      multaAtrasoPercent: multaAtraso,
      multaContratualPercent: multaContratual,
      proximoNumeroContrato: proximoContrato,
      proximoNumeroFatura: proximaFatura,
    });
    setSalvoFeedback(true);
    setTimeout(() => setSalvoFeedback(false), 2500);
  };

  const handleImportarAmostraI3tech = () => {
    const amostra = {
      clientes: [
        {
          nomeRazao: 'TecnoObras Construções e Estruturas Ltda (i3tech)',
          tipo: 'PJ' as const,
          cpfCnpj: '33.918.441/0001-99',
          email: 'obras@tecnoobras.com.br',
          telefone: '(17) 3224-1100',
          diaCorteFaturamento: 20,
          limiteCredito: 25000,
        },
        {
          nomeRazao: 'Marcelo Rossi Reformas ME (i3tech)',
          tipo: 'PJ' as const,
          cpfCnpj: '28.192.301/0001-44',
          email: 'marcelo.rossi@hotmail.com',
          telefone: '(17) 99111-9988',
          diaCorteFaturamento: 15,
          limiteCredito: 8000,
        },
      ],
      equipamentos: [
        {
          codigo: 'AND-ROD-01',
          categoria: 'andaimes' as const,
          nome: 'Rodízio Giratório de Poliuretano com Freio para Andaime',
          unidadeMedida: 'pç' as const,
          tipoControle: 'granel' as const,
          valorMensal: 35,
          valorQuinzenal: 22,
          valorSemanal: 14,
          valorDiaria: 5,
          valorReposicaoIndenizacao: 180,
        },
      ],
    };

    const resultado = importarDadosI3tech(amostra);
    setImportStatus(
      `Importação concluída com sucesso! ${resultado.clientesImportados} clientes e ${resultado.equipamentosImportados} equipamentos adicionados ao sistema.`
    );
  };

  // Abrir modal de criação
  const handleAbrirNovoUsuario = () => {
    setNovoNome('');
    setNovoEmail('');
    setNovoRole('vendedor');
    setNovaSenha('');
    setNovaSenhaConfirm('');
    setMostrarSenha(false);
    setErroNovo(null);
    setModalNovoOpen(true);
  };

  // Salvar novo usuário (POST /api/users)
  const handleCriarUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    setErroNovo(null);

    const nomeTrim = novoNome.trim();
    const emailTrim = novoEmail.trim().toLowerCase();

    if (nomeTrim.length < 3) {
      setErroNovo('O nome completo deve ter pelo menos 3 caracteres.');
      return;
    }
    if (!emailTrim.includes('@') || !emailTrim.includes('.')) {
      setErroNovo('Informe um e-mail válido para login.');
      return;
    }
    if (novaSenha.length < 8) {
      setErroNovo('A senha inicial deve ter pelo menos 8 caracteres.');
      return;
    }
    if (novaSenha !== novaSenhaConfirm) {
      setErroNovo('As senhas digitadas não conferem.');
      return;
    }

    setSalvandoNovo(true);
    try {
      await api.post('/users', {
        name: nomeTrim,
        email: emailTrim,
        role: novoRole,
        password: novaSenha,
      });

      setModalNovoOpen(false);
      setFeedbackUsuario(`Usuário "${nomeTrim}" criado com sucesso!`);
      setTimeout(() => setFeedbackUsuario(null), 4000);
      carregarUsuarios();
    } catch (err) {
      const e = err as ApiError;
      setErroNovo(e.message || 'Erro ao criar usuário no servidor.');
    } finally {
      setSalvandoNovo(false);
    }
  };

  // Abrir modal de edição
  const handleAbrirEditarUsuario = (u: UserRow) => {
    setModalEditOpen(u);
    setEditNome(u.name);
    setEditEmail(u.email);
    setEditRole(u.role);
    setEditActive(u.active);
    setEditSenha('');
    setEditSenhaConfirm('');
    setMostrarEditSenha(false);
    setErroEdit(null);
  };

  // Salvar edição (PUT /api/users/:id)
  const handleSalvarEdicao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalEditOpen) return;
    setErroEdit(null);

    const nomeTrim = editNome.trim();
    const emailTrim = editEmail.trim().toLowerCase();

    if (nomeTrim.length < 3) {
      setErroEdit('O nome completo deve ter pelo menos 3 caracteres.');
      return;
    }
    if (!emailTrim.includes('@') || !emailTrim.includes('.')) {
      setErroEdit('Informe um e-mail válido.');
      return;
    }
    if (editSenha && editSenha.length < 8) {
      setErroEdit('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (editSenha && editSenha !== editSenhaConfirm) {
      setErroEdit('As senhas digitadas não conferem.');
      return;
    }

    setSalvandoEdit(true);
    try {
      await api.put(`/users/${modalEditOpen.id}`, {
        name: nomeTrim,
        email: emailTrim,
        role: editRole,
        active: editActive,
        password: editSenha ? editSenha : undefined,
      });

      setModalEditOpen(null);
      setFeedbackUsuario(`Dados do usuário "${nomeTrim}" atualizados com sucesso!`);
      setTimeout(() => setFeedbackUsuario(null), 4000);
      carregarUsuarios();
    } catch (err) {
      const e = err as ApiError;
      setErroEdit(e.message || 'Erro ao atualizar usuário.');
    } finally {
      setSalvandoEdit(false);
    }
  };

  // Filtragem de usuários
  const usuariosFiltrados = users.filter((u) => {
    if (searchUser) {
      const q = searchUser.toLowerCase();
      const matchName = u.name.toLowerCase().includes(q);
      const matchEmail = u.email.toLowerCase().includes(q);
      if (!matchName && !matchEmail) return false;
    }
    if (filterRole !== 'todos' && u.role !== filterRole) return false;
    if (filterStatus === 'ativos' && !u.active) return false;
    if (filterStatus === 'inativos' && u.active) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#2AA3D8]" />
            Configurações do Sistema
          </h1>
          <p className="text-xs text-slate-500">
            Parâmetros operacionais da locadora, gestão de usuários & acessos e migrador de dados.
          </p>
        </div>
      </div>

      {/* Abas de Navegação das Configurações */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        <button
          onClick={() => setActiveTab('parametros')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'parametros'
              ? 'bg-[#2AA3D8] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Parâmetros de Negócio</span>
        </button>

        <button
          onClick={() => setActiveTab('usuarios')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'usuarios'
              ? 'bg-[#2AA3D8] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Usuários do Sistema</span>
          {isAdmin ? (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeTab === 'usuarios' ? 'bg-white text-[#2AA3D8]' : 'bg-purple-100 text-purple-700'
              }`}
            >
              Admin
            </span>
          ) : (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
              Restrito
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('migrador')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'migrador'
              ? 'bg-[#2AA3D8] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          <span>Migrador i3tech & Banco</span>
        </button>
      </div>

      {/* Feedback Toast */}
      {feedbackUsuario && (
        <div className="bg-emerald-50 border border-emerald-300 p-3.5 rounded-xl text-xs text-emerald-800 font-medium flex items-center justify-between shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackUsuario}</span>
          </div>
          <button onClick={() => setFeedbackUsuario(null)} className="text-emerald-700 hover:text-emerald-950 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ABA 1: PARÂMETROS DE NEGÓCIO */}
      {activeTab === 'parametros' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2">
                <Building className="w-4 h-4 text-[#2AA3D8]" />
                Diretrizes de Regras de Negócio
              </h2>
              {salvoFeedback && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Alterações Salvas!
                </span>
              )}
            </div>

            <form onSubmit={handleSalvarConfig} className="space-y-4 text-xs">
              {/* 1. Política de devolução antecipada */}
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <label className="block font-bold text-slate-800 mb-1">
                  1. Política de Cobrança na Devolução Antecipada
                </label>
                <div className="space-y-1.5 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="politicaDev"
                      checked={politicaDevolucao === 'proporcional'}
                      onChange={() => setPoliticaDevolucao('proporcional')}
                    />
                    <span>
                      <strong>Proporcional (Recomendado):</strong> Calcula a diária pro rata exata dos dias utilizados no ciclo atual.
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="politicaDev"
                      checked={politicaDevolucao === 'ciclo_cheio'}
                      onChange={() => setPoliticaDevolucao('ciclo_cheio')}
                    />
                    <span>
                      <strong>Ciclo Cheio Mínimo:</strong> Cobra no mínimo o valor integral do primeiro ciclo contratado (30 dias).
                    </span>
                  </label>
                </div>
              </div>

              {/* 2. Dia de Corte de Faturamento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    2. Dia de Corte de Faturamento Padrão
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={diaCortePadrao}
                    onChange={(e) => setDiaCortePadrao(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Ex: Dia 20 (cobre período de 21 do mês anterior a 20 do mês atual). Pode variar individualmente por cliente.
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    3. Chave PIX Padrão para Faturas (CNPJ)
                  </label>
                  <input
                    type="text"
                    value={chavePix}
                    onChange={(e) => setChavePix(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Chave utilizada na geração do QR Code e Copia-e-Cola das Faturas.
                  </span>
                </div>
              </div>

              {/* Multas e Juros */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Multa por Atraso (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={multaAtraso}
                    onChange={(e) => setMultaAtraso(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Percentual cobrado em títulos e faturas após o vencimento (padrão 2%).
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Multa Contratual por Rescisão (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={multaContratual}
                    onChange={(e) => setMultaContratual(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    Incide sobre o saldo restante em caso de quebra imotivada (padrão 20%).
                  </span>
                </div>
              </div>

              {/* Numeração Sequencial */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Próximo Nº de Contrato Sequencial
                  </label>
                  <input
                    type="number"
                    value={proximoContrato}
                    onChange={(e) => setProximoContrato(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-[#D9332B] bg-white"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    Permite continuidade a partir do último número emitido no i3tech.
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Próximo Nº de Fatura Sequencial
                  </label>
                  <input
                    type="number"
                    value={proximaFatura}
                    onChange={(e) => setProximaFatura(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  className="flex items-center gap-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white px-5 py-2.5 rounded-lg font-bold shadow-xs cursor-pointer transition-colors"
                >
                  <Save className="w-4 h-4" /> Salvar Parâmetros
                </button>
              </div>
            </form>
          </div>

          {/* Dica Lateral */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs h-fit space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2 pb-2 border-b border-slate-100">
              <Building className="w-4 h-4 text-[#2AA3D8]" />
              Dados da Empresa
            </h3>
            <div className="space-y-2 text-xs text-slate-600">
              <p><strong>Razão Social:</strong> {configEmpresa.razaoSocial}</p>
              <p><strong>Nome Fantasia:</strong> {configEmpresa.nomeFantasia}</p>
              <p><strong>CNPJ:</strong> <span className="font-mono">{configEmpresa.cnpj}</span></p>
              <p><strong>Cidade:</strong> {configEmpresa.cidade} – {configEmpresa.uf}</p>
              <p><strong>Telefone:</strong> {configEmpresa.telefone}</p>
              <p><strong>E-mail:</strong> {configEmpresa.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: GESTÃO DE USUÁRIOS (ADMIN) */}
      {activeTab === 'usuarios' && (
        <div className="space-y-5">
          {!isAdmin ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center max-w-xl mx-auto my-6 shadow-xs">
              <ShieldAlert className="w-12 h-12 text-amber-600 mx-auto mb-3" />
              <h3 className="font-bold text-slate-800 text-base">Acesso Restrito ao Administrador</h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                Apenas usuários com o perfil <strong>Administrador</strong> têm autorização para criar, editar,
                ativar/inativar usuários e redefinir credenciais de acesso ao sistema.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Seu usuário atual: <strong>{usuarioAtual?.nome}</strong> ({usuarioAtual?.perfil})
              </p>
            </div>
          ) : (
            <>
              <AcessoAbas />

              {/* KPIs de Usuários */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Total de Usuários</span>
                    <Users className="w-4 h-4 text-[#2AA3D8]" />
                  </div>
                  <div className="text-2xl font-black text-slate-900 font-mono">{users.length}</div>
                  <p className="text-[10px] text-slate-500 mt-0.5">Operadores cadastrados no banco</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Usuários Ativos</span>
                    <UserCheck className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-black text-emerald-700 font-mono">
                    {users.filter((u) => u.active).length}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">Podem acessar o sistema</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Administradores</span>
                    <KeyRound className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-2xl font-black text-purple-700 font-mono">
                    {users.filter((u) => u.role === 'admin' && u.active).length}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">Controle total de gestão</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider">Vendas & Balcão</span>
                    <Users className="w-4 h-4 text-sky-600" />
                  </div>
                  <div className="text-2xl font-black text-sky-700 font-mono">
                    {users.filter((u) => u.role === 'vendedor').length}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">Operadores comerciais</p>
                </div>
              </div>

              {/* Tabela de Usuários com Barra de Busca e Ações */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
                  <div className="flex-1 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchUser}
                        onChange={(e) => setSearchUser(e.target.value)}
                        placeholder="Buscar por nome ou e-mail..."
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                      />
                    </div>

                    <select
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700"
                    >
                      <option value="todos">Todos os perfis</option>
                      {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700"
                    >
                      <option value="todos">Todos os status</option>
                      <option value="ativos">Somente ativos</option>
                      <option value="inativos">Somente inativos</option>
                    </select>
                  </div>

                  {/* Botão de Criação de Usuário pelo Admin */}
                  <button
                    onClick={handleAbrirNovoUsuario}
                    className="flex items-center gap-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer shrink-0"
                  >
                    <UserPlus className="w-4 h-4" /> Cadastrar Novo Usuário
                  </button>
                </div>

                {/* Conteúdo da Tabela */}
                {loadingUsers && !users.length ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-[#2AA3D8] border-t-transparent mb-2" />
                    <p>Carregando usuários do sistema...</p>
                  </div>
                ) : usersError ? (
                  <div className="p-6 text-center text-xs text-red-600">
                    <p className="font-semibold mb-2">{usersError}</p>
                    <button
                      onClick={carregarUsuarios}
                      className="text-[#2AA3D8] underline hover:text-[#1a85b3] font-bold"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : usuariosFiltrados.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs">
                    Nenhum usuário encontrado com os filtros selecionados.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wide border-b border-slate-200">
                        <tr>
                          <th className="text-left font-semibold px-4 py-3">Operador / Nome</th>
                          <th className="text-left font-semibold px-4 py-3">E-mail (Login)</th>
                          <th className="text-left font-semibold px-4 py-3">Perfil de Acesso</th>
                          <th className="text-left font-semibold px-4 py-3">Situação</th>
                          <th className="text-left font-semibold px-4 py-3 hidden md:table-cell">Cadastrado em</th>
                          <th className="text-right font-semibold px-4 py-3">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {usuariosFiltrados.map((u) => {
                          const isSelf = u.id === authUser?.id || u.email === usuarioAtual?.email;
                          const initial = u.name.trim().charAt(0).toUpperCase() || 'U';

                          return (
                            <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs shrink-0">
                                    {initial}
                                  </div>
                                  <div>
                                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                      <span>{u.name}</span>
                                      {isSelf && (
                                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">
                                          Você
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-slate-400">ID #{u.id}</span>
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-3 font-mono text-xs text-slate-700">
                                {u.email}
                              </td>

                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                                    ROLE_BADGE_STYLES[u.role] || 'bg-slate-100 text-slate-700 border-slate-200'
                                  }`}
                                >
                                  {ROLE_LABELS[u.role] || u.role}
                                </span>
                              </td>

                              <td className="px-4 py-3">
                                {u.active ? (
                                  <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Ativo
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-slate-400 text-xs font-semibold">
                                    <span className="w-2 h-2 rounded-full bg-slate-400" /> Inativo
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500 font-mono">
                                {formatDateBR(u.created_at)}
                              </td>

                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => handleAbrirEditarUsuario(u)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-[#2AA3D8] hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                  title="Editar perfil ou senha"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  <span>Editar</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Guia de Perfis de Acesso */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
                  <p className="font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-[#2AA3D8]" />
                    Guia de Perfis de Acesso e Alçadas:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-[11px]">
                    {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                      <div key={r} className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="font-bold text-slate-800 block mb-0.5">{ROLE_LABELS[r]}</span>
                        <p className="text-slate-500">{ROLE_DESCRIPTIONS[r]}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ABA 3: MIGRADOR I3TECH */}
      {activeTab === 'migrador' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2 pb-3 mb-4 border-b border-slate-100">
              <UploadCloud className="w-4 h-4 text-[#D9332B]" />
              Migrador do Sistema i3tech
            </h2>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Importação em lote de clientes, obras e catálogo de equipamentos para transição imediata do i3tech sem retrabalho de digitação.
            </p>

            <div className="bg-blue-50 border border-blue-200 p-3.5 rounded-lg text-xs text-blue-900 mb-4">
              <p className="font-bold mb-1">Modelo de Importação Compatível:</p>
              <p className="text-[11px] text-blue-700">
                Aceita arquivo estruturado (JSON ou CSV exportado do i3tech) com campos cadastrais de pessoas físicas e jurídicas.
              </p>
            </div>

            {importStatus && (
              <div className="bg-emerald-50 border border-emerald-300 p-3.5 rounded-lg text-xs text-emerald-800 font-medium mb-4 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{importStatus}</span>
              </div>
            )}

            <button
              onClick={handleImportarAmostraI3tech}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              <Database className="w-4 h-4 text-[#2AA3D8]" /> Importar Lote de Cadastros i3tech
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs h-fit space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase flex items-center gap-2 pb-2 border-b border-slate-100">
              <RotateCcw className="w-4 h-4 text-red-600" />
              Manutenção de Dados Locais
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Restaura os dados originais de fábrica salvos no navegador para testes e simulações do sistema.
            </p>
            <button
              onClick={() => {
                if (confirm('Deseja restaurar os dados de demonstração iniciais da Central Locadora?')) {
                  resetarParaDadosPadrao();
                }
              }}
              className="w-full text-xs text-red-600 hover:text-white hover:bg-red-600 border border-red-300 hover:border-red-600 p-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restaurar dados padrão de fábrica
            </button>
          </div>
        </div>
      )}

      {/* MODAL 1: CADASTRAR NOVO USUÁRIO */}
      {modalNovoOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-[#2AA3D8]/10 text-[#2AA3D8] rounded-lg">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Cadastrar Novo Usuário</h3>
                  <p className="text-xs text-slate-500">Crie o acesso para um operador ou administrador</p>
                </div>
              </div>
              <button
                onClick={() => setModalNovoOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCriarUsuario} className="p-6 space-y-4">
              {erroNovo && (
                <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded text-xs text-red-700">
                  {erroNovo}
                </div>
              )}

              {/* Nome Completo */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome Completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Ex: Carlos Eduardo de Oliveira"
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                />
              </div>

              {/* E-mail / Login */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  E-mail de Login <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  placeholder="Ex: carlos@centrallocadora.com.br"
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 font-mono focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Este e-mail será utilizado para entrar no sistema.
                </span>
              </div>

              {/* Perfil de Acesso */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Perfil de Acesso <span className="text-red-500">*</span>
                </label>
                <select
                  value={novoRole}
                  onChange={(e) => setNovoRole(e.target.value as Role)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 font-semibold text-slate-800 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]} {r === 'admin' ? '(Acesso Total)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1.5 p-2 bg-slate-50 rounded border border-slate-200">
                  <strong>Permissões:</strong> {ROLE_DESCRIPTIONS[novoRole]}
                </p>
              </div>

              {/* Senha Inicial */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Senha Inicial <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={mostrarSenha ? 'text' : 'password'}
                      required
                      value={novaSenha}
                      onChange={(e) => setNovaSenha(e.target.value)}
                      placeholder="Mínimo 8 dígitos"
                      autoComplete="new-password"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 pr-8 font-mono focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarSenha(!mostrarSenha)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirmar Senha <span className="text-red-500">*</span>
                  </label>
                  <input
                    type={mostrarSenha ? 'text' : 'password'}
                    required
                    value={novaSenhaConfirm}
                    onChange={(e) => setNovaSenhaConfirm(e.target.value)}
                    placeholder="Repita a senha"
                    autoComplete="new-password"
                    className="w-full text-xs border border-slate-300 rounded-lg p-2.5 font-mono focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                  />
                </div>
              </div>

              {/* Ações */}
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalNovoOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoNovo}
                  className="flex items-center gap-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white px-5 py-2 rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {salvandoNovo ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Cadastrar Usuário</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDITAR USUÁRIO */}
      {modalEditOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in duration-150">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-purple-50 text-purple-700 rounded-lg">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">Editar Usuário</h3>
                  <p className="text-xs text-slate-500">Alterar dados, perfil ou redefinir senha</p>
                </div>
              </div>
              <button
                onClick={() => setModalEditOpen(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSalvarEdicao} className="p-6 space-y-4">
              {erroEdit && (
                <div className="p-3 bg-red-50 border-l-4 border-red-500 rounded text-xs text-red-700">
                  {erroEdit}
                </div>
              )}

              {/* Nome */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nome Completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editNome}
                  onChange={(e) => setEditNome(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                />
              </div>

              {/* E-mail */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  E-mail de Login <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 font-mono focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                />
              </div>

              {/* Perfil */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Perfil de Acesso <span className="text-red-500">*</span>
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as Role)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 font-semibold text-slate-800 bg-white focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]} {r === 'admin' ? '(Acesso Total)' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1.5 p-2 bg-slate-50 rounded border border-slate-200">
                  <strong>Permissões:</strong> {ROLE_DESCRIPTIONS[editRole]}
                </p>
              </div>

              {/* Status Ativo/Inativo */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">Status da Conta</span>
                  <span className="text-[11px] text-slate-500">
                    {editActive ? 'Usuário pode fazer login normalmente' : 'Acesso bloqueado ao sistema'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editActive}
                    disabled={modalEditOpen.id === authUser?.id}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-300 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Redefinição de Senha (Opcional) */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-0.5">
                    Redefinir Senha <span className="text-[10px] font-normal text-slate-500">(deixe em branco para manter a atual)</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <input
                      type={mostrarEditSenha ? 'text' : 'password'}
                      value={editSenha}
                      onChange={(e) => setEditSenha(e.target.value)}
                      placeholder="Nova senha (min 8 dígitos)"
                      autoComplete="new-password"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 pr-8 font-mono focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarEditSenha(!mostrarEditSenha)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {mostrarEditSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <div>
                    <input
                      type={mostrarEditSenha ? 'text' : 'password'}
                      value={editSenhaConfirm}
                      onChange={(e) => setEditSenhaConfirm(e.target.value)}
                      placeholder="Confirmar nova senha"
                      autoComplete="new-password"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 font-mono focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
                    />
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalEditOpen(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoEdit}
                  className="flex items-center gap-1.5 bg-[#2AA3D8] hover:bg-[#1a85b3] text-white px-5 py-2 rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {salvandoEdit ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Salvar Alterações</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
