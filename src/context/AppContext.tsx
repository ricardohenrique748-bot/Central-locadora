/**
 * Central Locação - App Context e Gerenciamento de Estado Global
 * Central BR Comércio e Locação de Equipamentos para Construção Civil Ltda
 * Desenvolvido por Lynus Tecnologia
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Cliente,
  Equipamento,
  Patrimonio,
  EstoqueGranel,
  Contrato,
  ContratoItem,
  ComprovanteDevolucao,
  Fatura,
  FaturaLinha,
  OrdemServico,
  ItemLogistica,
  ConfiguracoesEmpresa,
  Usuario,
} from '../types';
import {
  configEmpresaPadrao,
  usuariosPadrao,
  clientesIniciais,
  equipamentosIniciais,
  estoqueGranelInicial,
  patrimoniosIniciais,
  contratosIniciais,
  comprovantesDevolucaoIniciais,
  faturasIniciais,
  ordensServicoIniciais,
  logisticasIniciais,
} from '../data/mockData';
import { addDays, diffDays } from '../utils/billing';
import { api } from '../modules/orcamentos/api';
import { AuthUser } from '../../shared/orcamentos/types';

interface AppContextType {
  clientes: Cliente[];
  equipamentos: Equipamento[];
  patrimonios: Patrimonio[];
  estoqueGranel: EstoqueGranel[];
  contratos: Contrato[];
  comprovantesDevolucao: ComprovanteDevolucao[];
  faturas: Fatura[];
  ordensServico: OrdemServico[];
  logistica: ItemLogistica[];
  configEmpresa: ConfiguracoesEmpresa;
  usuarioAtual: Usuario | null;
  authUser: AuthUser | null;
  authLoading: boolean;
  /** Retorna null se entrou, ou a mensagem de erro. */
  login: (email: string, senha: string, lembrar: boolean) => Promise<string | null>;
  logout: () => void;

  // Clientes
  addCliente: (cliente: Omit<Cliente, 'id'>) => Cliente;
  updateCliente: (id: string, dados: Partial<Cliente>) => void;
  deleteCliente: (id: string) => void;

  // Equipamentos & Estoque
  addEquipamento: (equipamento: Omit<Equipamento, 'id'>) => Equipamento;
  updateEquipamento: (id: string, dados: Partial<Equipamento>) => void;
  updatePatrimonioStatus: (patrimonioId: string, status: Patrimonio['status']) => void;
  ajustarEstoqueGranel: (equipamentoId: string, deltaDisponivel: number, deltaLocado: number) => void;

  // Contratos & Orçamentos
  criarContrato: (dados: Omit<Contrato, 'id' | 'numeroContrato' | 'aditivos'>) => Contrato;
  converterOrcamentoParaContrato: (id: string) => void;
  adicionarItensAoContrato: (contratoId: string, novosItens: ContratoItem[], motivo: string) => void;
  encerrarContrato: (contratoId: string) => void;

  // Devoluções & Checklist
  registrarDevolucao: (dados: Omit<ComprovanteDevolucao, 'id' | 'numeroComprovante'>) => ComprovanteDevolucao;

  // Faturamento & Financeiro
  gerarFaturaConsolidada: (clienteId: string, contratoIds: string[], diaCorteRef?: string) => Fatura;
  pagarFatura: (faturaId: string, comprovante?: string) => void;
  cancelarFatura: (faturaId: string, motivo: string) => void;

  // Manutenção (OS)
  criarOrdemServico: (dados: Omit<OrdemServico, 'id' | 'numeroOS'>) => OrdemServico;
  atualizarOrdemServico: (id: string, dados: Partial<OrdemServico>) => void;

  // Logística
  agendarLogistica: (dados: Omit<ItemLogistica, 'id'>) => ItemLogistica;
  atualizarLogisticaStatus: (id: string, status: ItemLogistica['status']) => void;

  // Configurações & Importação
  atualizarConfigEmpresa: (dados: Partial<ConfiguracoesEmpresa>) => void;
  importarDadosI3tech: (dados: { clientes?: Partial<Cliente>[]; equipamentos?: Partial<Equipamento>[]; contratos?: any[] }) => { clientesImportados: number; equipamentosImportados: number; contratosImportados: number };
  resetarParaDadosPadrao: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_PREFIX = 'central_locacao_v2_';

function getStoredOrDefault<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(STORAGE_PREFIX + key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [clientes, setClientes] = useState<Cliente[]>(() => getStoredOrDefault('clientes', clientesIniciais));
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>(() => getStoredOrDefault('equipamentos', equipamentosIniciais));
  const [patrimonios, setPatrimonios] = useState<Patrimonio[]>(() => getStoredOrDefault('patrimonios', patrimoniosIniciais));
  const [estoqueGranel, setEstoqueGranel] = useState<EstoqueGranel[]>(() => getStoredOrDefault('estoqueGranel', estoqueGranelInicial));
  const [contratos, setContratos] = useState<Contrato[]>(() => getStoredOrDefault('contratos', contratosIniciais));
  const [comprovantesDevolucao, setComprovantesDevolucao] = useState<ComprovanteDevolucao[]>(() => getStoredOrDefault('comprovantesDevolucao', comprovantesDevolucaoIniciais));
  const [faturas, setFaturas] = useState<Fatura[]>(() => getStoredOrDefault('faturas', faturasIniciais));
  const [ordensServico, setOrdensServico] = useState<OrdemServico[]>(() => getStoredOrDefault('ordensServico', ordensServicoIniciais));
  const [logistica, setLogistica] = useState<ItemLogistica[]>(() => getStoredOrDefault('logistica', logisticasIniciais));
  const [configEmpresa, setConfigEmpresa] = useState<ConfiguracoesEmpresa>(() => getStoredOrDefault('configEmpresa', configEmpresaPadrao));
  // Autenticação no servidor: sessão em cookie httpOnly (30 dias com "lembrar", 12h sem)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const usuarioAtual: Usuario | null = authUser
    ? { id: String(authUser.id), nome: authUser.name, email: authUser.email, perfil: authUser.role }
    : null;

  useEffect(() => {
    api
      .get<{ user: AuthUser }>('/auth/me')
      .then((r) => setAuthUser(r.user))
      .catch(() => setAuthUser(null))
      .finally(() => setAuthLoading(false));
    const onUnauthorized = () => setAuthUser(null);
    window.addEventListener('cl:unauthorized', onUnauthorized);
    return () => window.removeEventListener('cl:unauthorized', onUnauthorized);
  }, []);

  const login = async (email: string, senha: string, lembrar: boolean): Promise<string | null> => {
    try {
      const r = await api.post<{ user: AuthUser }>('/auth/login', { email, password: senha, remember: lembrar });
      setAuthUser(r.user);
      try {
        if (lembrar) localStorage.setItem(STORAGE_PREFIX + 'emailLembrado', r.user.email);
        else localStorage.removeItem(STORAGE_PREFIX + 'emailLembrado');
      } catch {
        // armazenamento indisponível: só não lembra o e-mail
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const logout = () => {
    api.post('/auth/logout').catch(() => {});
    setAuthUser(null);
  };

  // Sincronizar com localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'clientes', JSON.stringify(clientes));
  }, [clientes]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'equipamentos', JSON.stringify(equipamentos));
  }, [equipamentos]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'patrimonios', JSON.stringify(patrimonios));
  }, [patrimonios]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'estoqueGranel', JSON.stringify(estoqueGranel));
  }, [estoqueGranel]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'contratos', JSON.stringify(contratos));
  }, [contratos]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'comprovantesDevolucao', JSON.stringify(comprovantesDevolucao));
  }, [comprovantesDevolucao]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'faturas', JSON.stringify(faturas));
  }, [faturas]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'ordensServico', JSON.stringify(ordensServico));
  }, [ordensServico]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'logistica', JSON.stringify(logistica));
  }, [logistica]);
  useEffect(() => {
    localStorage.setItem(STORAGE_PREFIX + 'configEmpresa', JSON.stringify(configEmpresa));
  }, [configEmpresa]);

  // Clientes
  const addCliente = (clienteData: Omit<Cliente, 'id'>): Cliente => {
    const novo: Cliente = {
      ...clienteData,
      id: `cli-${Date.now()}`,
    };
    setClientes((prev) => [novo, ...prev]);
    return novo;
  };

  const updateCliente = (id: string, dados: Partial<Cliente>) => {
    setClientes((prev) => prev.map((c) => (c.id === id ? { ...c, ...dados } : c)));
  };

  const deleteCliente = (id: string) => {
    setClientes((prev) => prev.filter((c) => c.id !== id));
  };

  // Equipamentos
  const addEquipamento = (equipData: Omit<Equipamento, 'id'>): Equipamento => {
    const novo: Equipamento = {
      ...equipData,
      id: `eq-${Date.now()}`,
    };
    setEquipamentos((prev) => [...prev, novo]);
    // Inicializar saldo em estoque caso seja granel
    if (novo.tipoControle === 'granel') {
      setEstoqueGranel((prev) => [
        ...prev,
        {
          equipamentoId: novo.id,
          total: 100,
          disponivel: 100,
          locado: 0,
          emManutencao: 0,
          emTeste: 0,
          extraviado: 0,
          baixado: 0,
        },
      ]);
    }
    return novo;
  };

  const updateEquipamento = (id: string, dados: Partial<Equipamento>) => {
    setEquipamentos((prev) => prev.map((e) => (e.id === id ? { ...e, ...dados } : e)));
  };

  const updatePatrimonioStatus = (patrimonioId: string, status: Patrimonio['status']) => {
    setPatrimonios((prev) =>
      prev.map((p) => (p.id === patrimonioId ? { ...p, status } : p))
    );
  };

  const ajustarEstoqueGranel = (equipamentoId: string, deltaDisponivel: number, deltaLocado: number) => {
    setEstoqueGranel((prev) =>
      prev.map((eg) => {
        if (eg.equipamentoId === equipamentoId) {
          return {
            ...eg,
            disponivel: Math.max(0, eg.disponivel + deltaDisponivel),
            locado: Math.max(0, eg.locado + deltaLocado),
          };
        }
        return eg;
      })
    );
  };

  // Contratos
  const criarContrato = (dados: Omit<Contrato, 'id' | 'numeroContrato' | 'aditivos'>): Contrato => {
    const num = String(configEmpresa.proximoNumeroContrato).padStart(6, '0');
    const novo: Contrato = {
      ...dados,
      id: `cnt-${Date.now()}`,
      numeroContrato: num,
      aditivos: [],
    };

    // Incrementar número sequencial
    setConfigEmpresa((cfg) => ({
      ...cfg,
      proximoNumeroContrato: cfg.proximoNumeroContrato + 1,
    }));

    // Se o status for 'ativo', debitar do estoque
    if (novo.status === 'ativo') {
      novo.itens.forEach((item) => {
        const equip = equipamentos.find((e) => e.id === item.equipamentoId);
        if (equip?.tipoControle === 'granel') {
          ajustarEstoqueGranel(item.equipamentoId, -item.quantidade, item.quantidade);
        } else if (item.patrimonioIds && item.patrimonioIds.length > 0) {
          item.patrimonioIds.forEach((patId) => {
            updatePatrimonioStatus(patId, 'locado');
          });
        }
      });
    }

    setContratos((prev) => [novo, ...prev]);
    return novo;
  };

  const converterOrcamentoParaContrato = (id: string) => {
    setContratos((prev) =>
      prev.map((c) => {
        if (c.id === id && c.status === 'orcamento') {
          // Debitar estoque
          c.itens.forEach((item) => {
            const equip = equipamentos.find((e) => e.id === item.equipamentoId);
            if (equip?.tipoControle === 'granel') {
              ajustarEstoqueGranel(item.equipamentoId, -item.quantidade, item.quantidade);
            } else if (item.patrimonioIds) {
              item.patrimonioIds.forEach((pid) => updatePatrimonioStatus(pid, 'locado'));
            }
          });
          return { ...c, status: 'ativo' };
        }
        return c;
      })
    );
  };

  const adicionarItensAoContrato = (contratoId: string, novosItens: ContratoItem[], motivo: string) => {
    setContratos((prev) =>
      prev.map((c) => {
        if (c.id === contratoId) {
          const aditivoNum = (c.aditivos?.length || 0) + 1;
          const valorAdicional = novosItens.reduce(
            (acc, it) => acc + it.valorUnitarioPeriodo * it.quantidade,
            0
          );

          // Atualizar estoque
          novosItens.forEach((item) => {
            const equip = equipamentos.find((e) => e.id === item.equipamentoId);
            if (equip?.tipoControle === 'granel') {
              ajustarEstoqueGranel(item.equipamentoId, -item.quantidade, item.quantidade);
            } else if (item.patrimonioIds) {
              item.patrimonioIds.forEach((pid) => updatePatrimonioStatus(pid, 'locado'));
            }
          });

          return {
            ...c,
            itens: [...c.itens, ...novosItens],
            totalMensalEstimado: c.totalMensalEstimado + valorAdicional,
            aditivos: [
              ...(c.aditivos || []),
              {
                id: `adt-${Date.now()}`,
                numeroAditivo: aditivoNum,
                dataAditivo: new Date().toISOString().split('T')[0],
                tipo: 'inclusao_itens',
                descricao: motivo,
                novosItens,
                valorAdicionalMensal: valorAdicional,
              },
            ],
          };
        }
        return c;
      })
    );
  };

  const encerrarContrato = (contratoId: string) => {
    setContratos((prev) =>
      prev.map((c) => (c.id === contratoId ? { ...c, status: 'encerrado' } : c))
    );
  };

  // Devoluções & Checklist
  const registrarDevolucao = (
    dados: Omit<ComprovanteDevolucao, 'id' | 'numeroComprovante'>
  ): ComprovanteDevolucao => {
    const num = `DEV-${String(configEmpresa.proximoNumeroDevolucao).padStart(6, '0')}`;
    const novaDevolucao: ComprovanteDevolucao = {
      ...dados,
      id: `dev-${Date.now()}`,
      numeroComprovante: num,
    };

    setConfigEmpresa((cfg) => ({
      ...cfg,
      proximoNumeroDevolucao: cfg.proximoNumeroDevolucao + 1,
    }));

    // Processar retorno ao estoque conforme condição de cada item
    dados.itens.forEach((it) => {
      const equip = equipamentos.find((e) => e.id === it.equipamentoId);

      if (equip?.tipoControle === 'granel') {
        setEstoqueGranel((prev) =>
          prev.map((eg) => {
            if (eg.equipamentoId === it.equipamentoId) {
              let disp = eg.disponivel;
              let manut = eg.emManutencao;
              let teste = eg.emTeste;
              let extrav = eg.extraviado;

              if (it.condicao === 'conforme') {
                disp += it.quantidadeDevolvida;
              } else if (it.condicao === 'danificado_sujo') {
                manut += it.quantidadeDevolvida;
              } else if (it.condicao === 'testar_na_empresa') {
                teste += it.quantidadeDevolvida;
              } else if (it.condicao === 'extraviado_roubado') {
                extrav += it.quantidadeDevolvida;
              }

              return {
                ...eg,
                locado: Math.max(0, eg.locado - it.quantidadeDevolvida),
                disponivel: disp,
                emManutencao: manut,
                emTeste: teste,
                extraviado: extrav,
              };
            }
            return eg;
          })
        );
      } else if (it.patrimonioId) {
        let statusPat: Patrimonio['status'] = 'disponivel';
        if (it.condicao === 'danificado_sujo') statusPat = 'em_manutencao';
        if (it.condicao === 'testar_na_empresa') statusPat = 'em_teste';
        if (it.condicao === 'extraviado_roubado') statusPat = 'extraviado';
        updatePatrimonioStatus(it.patrimonioId, statusPat);
      }
    });

    // Atualizar status dos itens do contrato
    setContratos((prev) =>
      prev.map((c) => {
        if (c.id === dados.contratoId) {
          const itensAtualizados = c.itens.map((cItem) => {
            const devItem = dados.itens.find((d) => d.itemId === cItem.id);
            if (devItem) {
              const novaQtdeDevolvida = cItem.quantidadeDevolvida + devItem.quantidadeDevolvida;
              const devolvidoTudo = novaQtdeDevolvida >= cItem.quantidade;
              return {
                ...cItem,
                quantidadeDevolvida: novaQtdeDevolvida,
                status: devolvidoTudo
                  ? ('devolvido_total' as const)
                  : ('devolvido_parcial' as const),
                dataDevolucao: devolvidoTudo ? dados.dataHora.split(' ')[0] : cItem.dataDevolucao,
              };
            }
            return cItem;
          });

          // Se todos os itens foram devolvidos totalmente, encerrar o contrato
          const todosDevolvidos = itensAtualizados.every(
            (it) => it.status === 'devolvido_total'
          );

          return {
            ...c,
            itens: itensAtualizados,
            status: todosDevolvidos ? 'encerrado' : c.status,
          };
        }
        return c;
      })
    );

    // Se houver cobranças de avarias/reposições/extravio, gerar fatura de cobrança automática
    if (dados.totalCobrancasAvarias > 0) {
      const linhasAvarias: FaturaLinha[] = dados.itens
        .filter((it) => (it.valorCobrancaAvaria || 0) > 0)
        .map((it) => ({
          id: `lin-av-${Date.now()}-${it.itemId}`,
          contratoId: dados.contratoId,
          descricao: `COBRANÇA DE ${it.condicao === 'extraviado_roubado' ? 'EXTRAVIO / REPOSIÇÃO' : 'AVARIA / MANUTENÇÃO'} - ${it.descricao} (${it.quantidadeDevolvida} un/pç): ${it.observacao || ''}`,
          tipo: it.condicao === 'extraviado_roubado' ? 'reposicao' : 'avaria',
          quantidade: it.quantidadeDevolvida,
          valorUnitario: (it.valorCobrancaAvaria || 0) / it.quantidadeDevolvida,
          valorTotal: it.valorCobrancaAvaria || 0,
        }));

      const numFat = `FAT-${String(configEmpresa.proximoNumeroFatura).padStart(6, '0')}`;
      const dataHoje = new Date().toISOString().split('T')[0];
      const dataVenc = addDays(dataHoje, 30); // 30 dias para pagar avarias conforme contrato

      const novaFaturaAvaria: Fatura = {
        id: `fat-${Date.now()}`,
        numeroFatura: numFat,
        dataEmissao: dataHoje,
        dataVencimento: dataVenc,
        clienteId: dados.clienteId,
        obraId: dados.obraId,
        contratosVinculados: [dados.contratoId],
        linhas: linhasAvarias,
        valorSubtotal: dados.totalCobrancasAvarias,
        valorAcrescimos: 0,
        valorDesconto: 0,
        valorTotal: dados.totalCobrancasAvarias,
        status: 'aberta',
        chavePix: configEmpresa.chavePix,
        pixQrCode: '00020126360014BR.GOV.BCB.PIX0114184923110001445204000053039865406000.005802BR5925CENTRAL BR COMERCIO LOCAC6022SAO JOSE DO RIO PRETO62070503***6304ABCD',
        pixCopiaECola: '00020126360014BR.GOV.BCB.PIX0114184923110001445204000053039865406000.005802BR5925CENTRAL BR COMERCIO LOCAC6022SAO JOSE DO RIO PRETO62070503***6304ABCD',
        codigoBarrasBoleto: '07790.00116 12345.678902 12345.678903 3 98470000000000',
        observacoesFiscais: 'Ressarcimento de Avarias / Reposição de Bens Móveis Locados conforme cláusula 7ª e 10ª do Contrato de Locação.',
      };

      setFaturas((prev) => [novaFaturaAvaria, ...prev]);
      setConfigEmpresa((cfg) => ({
        ...cfg,
        proximoNumeroFatura: cfg.proximoNumeroFatura + 1,
      }));
      novaDevolucao.gerouFaturaCobranca = true;
    }

    setComprovantesDevolucao((prev) => [novaDevolucao, ...prev]);
    return novaDevolucao;
  };

  // Faturamento
  const gerarFaturaConsolidada = (clienteId: string, contratoIds: string[], diaCorteRef?: string): Fatura => {
    const cliente = clientes.find((c) => c.id === clienteId);
    const dataHoje = new Date().toISOString().split('T')[0];
    const corte = diaCorteRef || dataHoje;
    const dataVenc = addDays(corte, 15); // Vencimento padrão 15 dias após o corte
    const numFat = `FAT-${String(configEmpresa.proximoNumeroFatura).padStart(6, '0')}`;

    const linhas: FaturaLinha[] = [];
    let subtotal = 0;

    contratoIds.forEach((cId) => {
      const c = contratos.find((item) => item.id === cId);
      if (!c) return;

      c.itens.forEach((it) => {
        const equip = equipamentos.find((e) => e.id === it.equipamentoId);
        const diasUso = diffDays(it.dataInicio, corte);
        const valorPeriodo = it.valorUnitarioPeriodo * it.quantidade;

        // Linha de ciclo da locação
        const desc = `CONTR.${c.numeroContrato} - ${it.quantidade} ${equip?.unidadeMedida || 'pç'} ${equip?.nome || 'Equipamento'} - PERÍODO ${it.dataInicio} A ${corte}`;
        linhas.push({
          id: `lin-${Date.now()}-${it.id}`,
          contratoId: c.id,
          descricao: desc,
          tipo: 'locacao',
          periodoDe: it.dataInicio,
          periodoAte: corte,
          quantidade: it.quantidade,
          valorUnitario: it.valorUnitarioPeriodo,
          valorTotal: valorPeriodo,
        });
        subtotal += valorPeriodo;
      });

      // Frete se houver
      if (c.freteEntrega > 0) {
        linhas.push({
          id: `lin-fr-${Date.now()}-${c.id}`,
          contratoId: c.id,
          descricao: `CONTR.${c.numeroContrato} - TAXA DE ENTREGA / TRANSPORTE DE MATERIAL NA OBRA`,
          tipo: 'frete',
          quantidade: 1,
          valorUnitario: c.freteEntrega,
          valorTotal: c.freteEntrega,
        });
        subtotal += c.freteEntrega;
      }
    });

    const novaFatura: Fatura = {
      id: `fat-${Date.now()}`,
      numeroFatura: numFat,
      dataEmissao: dataHoje,
      dataVencimento: dataVenc,
      clienteId,
      contratosVinculados: contratoIds,
      linhas,
      valorSubtotal: Number(subtotal.toFixed(2)),
      valorAcrescimos: 0,
      valorDesconto: 0,
      valorTotal: Number(subtotal.toFixed(2)),
      status: 'aberta',
      chavePix: configEmpresa.chavePix,
      pixQrCode: '00020126360014BR.GOV.BCB.PIX0114184923110001445204000053039865406000.005802BR5925CENTRAL BR COMERCIO LOCAC6022SAO JOSE DO RIO PRETO62070503***6304FFFF',
      pixCopiaECola: '00020126360014BR.GOV.BCB.PIX0114184923110001445204000053039865406000.005802BR5925CENTRAL BR COMERCIO LOCAC6022SAO JOSE DO RIO PRETO62070503***6304FFFF',
      codigoBarrasBoleto: `07790.00116 12345.678902 12345.678903 4 9848${String(Math.round(subtotal * 100)).padStart(10, '0')}`,
      observacoesFiscais: 'Natureza da operação: Locação de Bens Móveis. Não é fato gerador de ISSQN. Dispensado de NF conforme Lei Complementar 116/2003. Locação de equipamento sem fornecimento de mão de obra.',
    };

    setConfigEmpresa((cfg) => ({
      ...cfg,
      proximoNumeroFatura: cfg.proximoNumeroFatura + 1,
    }));

    setFaturas((prev) => [novaFatura, ...prev]);

    // Atualizar saldo devedor do cliente
    if (cliente) {
      updateCliente(cliente.id, {
        saldoDevedor: (cliente.saldoDevedor || 0) + novaFatura.valorTotal,
      });
    }

    return novaFatura;
  };

  const pagarFatura = (faturaId: string, comprovante?: string) => {
    setFaturas((prev) =>
      prev.map((f) => {
        if (f.id === faturaId) {
          const cliente = clientes.find((c) => c.id === f.clienteId);
          if (cliente) {
            updateCliente(cliente.id, {
              saldoDevedor: Math.max(0, (cliente.saldoDevedor || 0) - f.valorTotal),
            });
          }
          return {
            ...f,
            status: 'paga',
            dataPagamento: new Date().toISOString().split('T')[0],
            comprovantePagamento: comprovante || 'Pagamento confirmado via PIX/Boleto bancário',
          };
        }
        return f;
      })
    );
  };

  const cancelarFatura = (faturaId: string, motivo: string) => {
    setFaturas((prev) =>
      prev.map((f) => {
        if (f.id === faturaId) {
          const cliente = clientes.find((c) => c.id === f.clienteId);
          if (cliente && f.status !== 'paga') {
            updateCliente(cliente.id, {
              saldoDevedor: Math.max(0, (cliente.saldoDevedor || 0) - f.valorTotal),
            });
          }
          return {
            ...f,
            status: 'cancelada',
            motivoCancelamento: motivo,
          };
        }
        return f;
      })
    );
  };

  // Manutenção OS
  const criarOrdemServico = (dados: Omit<OrdemServico, 'id' | 'numeroOS'>): OrdemServico => {
    const num = `OS-${String(ordensServico.length + 111).padStart(5, '0')}`;
    const novaOS: OrdemServico = {
      ...dados,
      id: `os-${Date.now()}`,
      numeroOS: num,
    };
    updatePatrimonioStatus(dados.patrimonioId, 'em_manutencao');
    setOrdensServico((prev) => [novaOS, ...prev]);
    return novaOS;
  };

  const atualizarOrdemServico = (id: string, dados: Partial<OrdemServico>) => {
    setOrdensServico((prev) =>
      prev.map((os) => {
        if (os.id === id) {
          const updated = { ...os, ...dados };
          if (dados.status === 'concluida') {
            updatePatrimonioStatus(os.patrimonioId, 'disponivel');
          }
          return updated;
        }
        return os;
      })
    );
  };

  // Logística
  const agendarLogistica = (dados: Omit<ItemLogistica, 'id'>): ItemLogistica => {
    const novo: ItemLogistica = {
      ...dados,
      id: `log-${Date.now()}`,
    };
    setLogistica((prev) => [novo, ...prev]);
    return novo;
  };

  const atualizarLogisticaStatus = (id: string, status: ItemLogistica['status']) => {
    setLogistica((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
  };

  // Configurações
  const atualizarConfigEmpresa = (dados: Partial<ConfiguracoesEmpresa>) => {
    setConfigEmpresa((prev) => ({ ...prev, ...dados }));
  };

  // Importação i3tech
  const importarDadosI3tech = (dados: {
    clientes?: Partial<Cliente>[];
    equipamentos?: Partial<Equipamento>[];
    contratos?: any[];
  }) => {
    let cliCount = 0;
    let eqCount = 0;
    let cntCount = 0;

    if (dados.clientes && dados.clientes.length > 0) {
      const novosClientes: Cliente[] = dados.clientes.map((c, i) => ({
        id: `cli-imp-${Date.now()}-${i}`,
        tipo: c.tipo || 'PJ',
        nomeRazao: c.nomeRazao || 'Cliente Importado i3tech',
        nomeFantasia: c.nomeFantasia,
        cpfCnpj: c.cpfCnpj || '00.000.000/0000-00',
        rgIe: c.rgIe,
        email: c.email || 'contato@cliente.com.br',
        telefone: c.telefone || '(17) 3000-0000',
        diaCorteFaturamento: c.diaCorteFaturamento || 20,
        limiteCredito: c.limiteCredito || 10000,
        saldoDevedor: c.saldoDevedor || 0,
        bloqueado: !!c.bloqueado,
        obras: c.obras || [
          {
            id: `obr-imp-${i}`,
            nomeIdentificacao: 'Obra Principal',
            logradouro: 'Endereço da Obra',
            numero: '100',
            bairro: 'Centro',
            cidade: 'São José do Rio Preto',
            uf: 'SP',
            cep: '15015-000',
            responsavelNome: 'Mestre da Obra',
            responsavelTelefone: '(17) 99000-0000',
          },
        ],
      }));
      setClientes((prev) => [...novosClientes, ...prev]);
      cliCount = novosClientes.length;
    }

    if (dados.equipamentos && dados.equipamentos.length > 0) {
      const novosEquipamentos: Equipamento[] = dados.equipamentos.map((e, i) => ({
        id: `eq-imp-${Date.now()}-${i}`,
        codigo: e.codigo || `IMP-${i + 1}`,
        categoria: e.categoria || 'andaimes',
        nome: e.nome || 'Equipamento Importado',
        descricao: e.descricao || '',
        unidadeMedida: e.unidadeMedida || 'pç',
        tipoControle: e.tipoControle || 'granel',
        valorDiaria: e.valorDiaria || 2,
        valorSemanal: e.valorSemanal || 6,
        valorQuinzenal: e.valorQuinzenal || 9,
        valorMensal: e.valorMensal || 15,
        valorReposicaoIndenizacao: e.valorReposicaoIndenizacao || 100,
      }));
      setEquipamentos((prev) => [...prev, ...novosEquipamentos]);
      eqCount = novosEquipamentos.length;
    }

    return {
      clientesImportados: cliCount,
      equipamentosImportados: eqCount,
      contratosImportados: cntCount,
    };
  };

  const resetarParaDadosPadrao = () => {
    setClientes(clientesIniciais);
    setEquipamentos(equipamentosIniciais);
    setPatrimonios(patrimoniosIniciais);
    setEstoqueGranel(estoqueGranelInicial);
    setContratos(contratosIniciais);
    setComprovantesDevolucao(comprovantesDevolucaoIniciais);
    setFaturas(faturasIniciais);
    setOrdensServico(ordensServicoIniciais);
    setLogistica(logisticasIniciais);
    setConfigEmpresa(configEmpresaPadrao);
    localStorage.clear();
  };

  return (
    <AppContext.Provider
      value={{
        clientes,
        equipamentos,
        patrimonios,
        estoqueGranel,
        contratos,
        comprovantesDevolucao,
        faturas,
        ordensServico,
        logistica,
        configEmpresa,
        usuarioAtual,
        authUser,
        authLoading,
        login,
        logout,
        addCliente,
        updateCliente,
        deleteCliente,
        addEquipamento,
        updateEquipamento,
        updatePatrimonioStatus,
        ajustarEstoqueGranel,
        criarContrato,
        converterOrcamentoParaContrato,
        adicionarItensAoContrato,
        encerrarContrato,
        registrarDevolucao,
        gerarFaturaConsolidada,
        pagarFatura,
        cancelarFatura,
        criarOrdemServico,
        atualizarOrdemServico,
        agendarLogistica,
        atualizarLogisticaStatus,
        atualizarConfigEmpresa,
        importarDadosI3tech,
        resetarParaDadosPadrao,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
