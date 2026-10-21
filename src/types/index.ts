/**
 * Central Locação - Modelos de Dados e Tipos do Sistema
 * Central BR Comércio e Locação de Equipamentos para Construção Civil Ltda
 * Desenvolvido por Lynus Tecnologia
 */

export type TipoPessoa = 'PF' | 'PJ';

export interface Obra {
  id: string;
  nomeIdentificacao: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  responsavelNome: string;
  responsavelTelefone: string;
}

export interface Cliente {
  id: string;
  tipo: TipoPessoa;
  nomeRazao: string;
  nomeFantasia?: string;
  cpfCnpj: string;
  rgIe?: string;
  email: string;
  telefone: string;
  contatoFinanceiro?: string;
  diaCorteFaturamento: number; // Ex: dia 20
  limiteCredito: number;
  saldoDevedor: number;
  bloqueado: boolean;
  motivoBloqueio?: string;
  obras: Obra[];
  observacoes?: string;
}

export type TipoControleEquipamento = 'granel' | 'serializado';

export type CategoriaEquipamento =
  | 'andaimes'
  | 'escoramento'
  | 'ferramentas_eletricas'
  | 'concreto'
  | 'compactacao'
  | 'acessorios';

export interface PecaAvulsa {
  id: string;
  descricao: string;
  valorReposicao: number;
}

export interface Equipamento {
  id: string;
  codigo: string;
  categoria: CategoriaEquipamento;
  nome: string;
  descricao: string;
  unidadeMedida: 'pç' | 'un' | 'm' | 'cj';
  tipoControle: TipoControleEquipamento;
  valorDiaria: number;
  valorSemanal: number;
  valorQuinzenal: number;
  valorMensal: number;
  valorReposicaoIndenizacao: number;
  pecasAvulsas?: PecaAvulsa[];
  kitItens?: { equipamentoId: string; quantidade: number }[];
  imagemUrl?: string;
}

export type StatusPatrimonio =
  | 'disponivel'
  | 'locado'
  | 'em_manutencao'
  | 'em_teste'
  | 'extraviado'
  | 'baixado';

export interface Patrimonio {
  id: string;
  equipamentoId: string;
  numeroSerie: string; // Ex: "PAT-MAR-004"
  anoFabricacao: number;
  status: StatusPatrimonio;
  horasUso: number;
  ultimaManutencao?: string;
  contratoAtualId?: string;
  localizacaoObra?: string;
}

export interface EstoqueGranel {
  equipamentoId: string;
  total: number;
  disponivel: number;
  locado: number;
  emManutencao: number;
  emTeste: number;
  extraviado: number;
  baixado: number;
}

export type PeriodoLocacao = 'diaria' | 'semanal' | 'quinzenal' | 'mensal';

export interface ContratoItem {
  id: string;
  equipamentoId: string;
  quantidade: number;
  valorUnitarioPeriodo: number;
  periodoTipo: PeriodoLocacao;
  dataInicio: string; // YYYY-MM-DD
  dataProximaRenovacao: string; // YYYY-MM-DD
  dataDevolucao?: string;
  quantidadeDevolvida: number;
  status: 'ativo' | 'devolvido_total' | 'devolvido_parcial' | 'extraviado';
  patrimonioIds?: string[];
  valorIndenizacaoUnitario: number;
  observacoes?: string;
}

export type StatusContrato = 'orcamento' | 'ativo' | 'encerrado' | 'cancelado';

export interface AditivoContrato {
  id: string;
  numeroAditivo: number;
  dataAditivo: string;
  tipo: 'inclusao_itens' | 'alteracao_prazo' | 'reajuste_igpm' | 'substituicao';
  descricao: string;
  novosItens?: ContratoItem[];
  valorAdicionalMensal: number;
}

export interface Contrato {
  id: string;
  numeroContrato: string; // Ex: "009537"
  dataEmissao: string;
  clienteId: string;
  obraId: string;
  status: StatusContrato;
  itens: ContratoItem[];
  freteEntrega: number;
  freteRecolhimento: number;
  modalidadeTransporte: 'entrega_locadora' | 'retirada_balcao';
  totalMensalEstimado: number;
  clausulasCustomizadas?: string;
  aditivos: AditivoContrato[];
  observacoes?: string;
  responsavelLocadora: string;
  responsavelLocatarioNome?: string;
  responsavelLocatarioRg?: string;
}

export type CondicaoItemDevolucao =
  | 'conforme'
  | 'danificado_sujo'
  | 'extraviado_roubado'
  | 'testar_na_empresa';

export interface ItemDevolvidoChecklist {
  itemId: string;
  equipamentoId: string;
  descricao: string;
  quantidadeDevolvida: number;
  patrimonioId?: string;
  condicao: CondicaoItemDevolucao;
  observacao?: string;
  valorCobrancaAvaria?: number;
  fotos?: string[];
}

export interface ComprovanteDevolucao {
  id: string;
  numeroComprovante: string; // Ex: "DEV-009537-01"
  contratoId: string;
  clienteId: string;
  obraId: string;
  dataHora: string;
  localEntrega: 'balcao' | 'obra';
  itens: ItemDevolvidoChecklist[];
  totalCobrancasAvarias: number;
  gerouFaturaCobranca?: boolean;
  assinaturaRecebedor: {
    nome: string;
    rg: string;
    telefone: string;
    assinaturaDataUrl: string;
  };
  assinaturaLocadora: {
    nome: string;
    assinaturaDataUrl: string;
  };
  cidade: string;
}

export interface FaturaLinha {
  id: string;
  contratoId?: string;
  descricao: string;
  tipo: 'locacao' | 'pro_rata' | 'frete' | 'avaria' | 'reposicao' | 'montagem' | 'outros';
  periodoDe?: string;
  periodoAte?: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

export type StatusFatura = 'aberta' | 'paga' | 'vencida' | 'cancelada';

export interface Fatura {
  id: string;
  numeroFatura: string; // Ex: "FAT-009537"
  dataEmissao: string;
  dataVencimento: string;
  clienteId: string;
  obraId?: string;
  contratosVinculados: string[];
  linhas: FaturaLinha[];
  valorSubtotal: number;
  valorAcrescimos: number; // juros/multa
  valorDesconto: number;
  valorTotal: number;
  status: StatusFatura;
  dataPagamento?: string;
  comprovantePagamento?: string;
  motivoCancelamento?: string;
  chavePix: string;
  pixQrCode: string;
  pixCopiaECola: string;
  codigoBarrasBoleto: string;
  observacoesFiscais?: string;
}

export interface OrdemServico {
  id: string;
  numeroOS: string;
  patrimonioId: string;
  equipamentoId: string;
  tipo: 'preventiva' | 'corretiva';
  status: 'aberta' | 'em_andamento' | 'aguardando_peca' | 'concluida';
  dataAbertura: string;
  dataConclusao?: string;
  mecanicoResponsavel: string;
  custoPecas: number;
  custoMaoObra: number;
  horasParado: number;
  diagnostico: string;
  servicosExecutados?: string;
}

export interface ItemLogistica {
  id: string;
  tipo: 'entrega' | 'recolhimento';
  contratoId: string;
  clienteId: string;
  obraId: string;
  dataAgendada: string;
  turno: 'manha' | 'tarde';
  motorista: string;
  veiculoPlaca: string;
  status: 'agendado' | 'em_transito' | 'concluido' | 'cancelado';
  valorFrete: number;
  itensResumo: string;
}

export interface ConfiguracoesEmpresa {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  email: string;
  chavePix: string;
  tipoChavePix: 'cnpj' | 'email' | 'telefone' | 'aleatoria';
  bancoNome: string;
  politicaDevolucao: 'proporcional' | 'ciclo_cheio';
  diaCortePadrao: number; // 20
  multaAtrasoPercent: number; // 2%
  jurosMoraPercentAoDia: number; // 0.033% (1% ao mês)
  multaContratualPercent: number; // 20%
  proximoNumeroContrato: number; // 9538
  proximoNumeroFatura: number; // 2846
  proximoNumeroDevolucao: number; // 4129
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: 'admin' | 'gestor' | 'vendedor' | 'estoquista' | 'financeiro' | 'tecnico' | 'consulta' | 'balcao' | 'financeiro' | 'logistica' | 'manutencao';
}
