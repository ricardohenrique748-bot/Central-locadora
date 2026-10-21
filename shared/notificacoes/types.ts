/**
 * Catálogo de eventos de notificação e tipos da central.
 * Prazos, perfis e ativação de cada evento são configuráveis (notification_settings); aqui ficam só os padrões.
 */

import { Role } from '../orcamentos/types';

export type Category = 'contratos' | 'financeiro' | 'estoque' | 'manutencao' | 'logistica' | 'orcamentos' | 'sistema';
export const CATEGORY_LABELS: Record<Category, string> = {
  contratos: 'Contratos',
  financeiro: 'Financeiro',
  estoque: 'Estoque e equipamentos',
  manutencao: 'Ordens de serviço',
  logistica: 'Entregas e devoluções',
  orcamentos: 'Orçamentos',
  sistema: 'Sistema',
};

export type Priority = 'baixa' | 'media' | 'alta' | 'critica';
export const PRIORITY_LABELS: Record<Priority, string> = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };

export interface EventDef {
  type: string;
  category: Category;
  label: string;
  description: string;
  priority: Priority;
  /** Persistente: some sozinho quando a condição deixa de existir (pago, devolvido...). */
  stateful: boolean;
  /** Usa antecedência em dias (lista). */
  leads?: number[];
  /** Usa período de inatividade/acompanhamento em dias. */
  inactivity?: number;
  roles: Role[];
  /** Avisa também o responsável pelo registro (vendedor/técnico/responsável da operação). */
  responsible: boolean;
  /** Crítico: não pode ser desativado. */
  critical?: boolean;
}

const OPS: Role[] = ['admin', 'gestor', 'estoquista'];
const FIN: Role[] = ['admin', 'gestor', 'financeiro'];

export const EVENTS: EventDef[] = [
  // contratos
  { type: 'contrato.vencendo', category: 'contratos', label: 'Contrato próximo do vencimento', description: 'Término do contrato dentro das antecedências configuradas.', priority: 'media', stateful: true, leads: [7, 3, 1], roles: ['admin', 'gestor'], responsible: true },
  { type: 'contrato.vence_hoje', category: 'contratos', label: 'Contrato vence hoje', description: 'Dia do término (dia da devolução).', priority: 'alta', stateful: true, roles: ['admin', 'gestor', 'estoquista'], responsible: true },
  { type: 'contrato.vencido', category: 'contratos', label: 'Contrato vencido sem encerramento ou renovação', description: 'Prazo encerrado sem prorrogação registrada.', priority: 'alta', stateful: true, roles: ['admin', 'gestor'], responsible: true },
  { type: 'contrato.devolucao_hoje', category: 'contratos', label: 'Devolução prevista para hoje', description: 'Equipamentos com o cliente cujo término é hoje.', priority: 'media', stateful: true, roles: OPS, responsible: false },
  { type: 'contrato.devolucao_atrasada', category: 'contratos', label: 'Devolução atrasada', description: 'Equipamentos ainda com o cliente após o término.', priority: 'critica', stateful: true, roles: OPS, responsible: true, critical: true },
  { type: 'contrato.pendencia_operacional', category: 'contratos', label: 'Contrato com pendência operacional', description: 'Contrato em encerramento aguardando devolução, ou com equipamento devolvido aguardando conferência.', priority: 'media', stateful: true, roles: OPS, responsible: false },
  { type: 'contrato.pendencia_financeira', category: 'contratos', label: 'Contrato com cobrança vencida', description: 'Cobranças do contrato vencidas no Financeiro (somente perfis do Financeiro).', priority: 'alta', stateful: true, roles: FIN, responsible: false },
  // financeiro
  { type: 'financeiro.receber_vencendo', category: 'financeiro', label: 'Conta a receber próxima do vencimento', description: 'Parcela a receber em aberto que vence dentro das antecedências.', priority: 'baixa', stateful: true, leads: [3, 1], roles: FIN, responsible: false },
  { type: 'financeiro.receber_hoje', category: 'financeiro', label: 'Recebimento previsto para hoje', description: 'Parcela a receber com vencimento hoje.', priority: 'media', stateful: true, roles: FIN, responsible: false },
  { type: 'financeiro.receber_vencido', category: 'financeiro', label: 'Conta a receber vencida', description: 'Parcela a receber vencida e não liquidada.', priority: 'alta', stateful: true, roles: FIN, responsible: false, critical: true },
  { type: 'financeiro.pagar_vencendo', category: 'financeiro', label: 'Conta a pagar próxima do vencimento', description: 'Parcela a pagar em aberto que vence dentro das antecedências.', priority: 'media', stateful: true, leads: [3, 1], roles: FIN, responsible: false },
  { type: 'financeiro.pagar_hoje', category: 'financeiro', label: 'Pagamento previsto para hoje', description: 'Parcela a pagar com vencimento hoje.', priority: 'alta', stateful: true, roles: FIN, responsible: false },
  { type: 'financeiro.pagar_vencido', category: 'financeiro', label: 'Conta a pagar vencida', description: 'Parcela a pagar vencida e não liquidada.', priority: 'critica', stateful: true, roles: FIN, responsible: false, critical: true },
  // estoque
  { type: 'estoque.abaixo_minimo', category: 'estoque', label: 'Estoque abaixo do mínimo', description: 'Item controlado por quantidade com disponível abaixo do mínimo configurado (patrimônios individuais não entram).', priority: 'media', stateful: true, roles: OPS, responsible: false },
  { type: 'estoque.sem_saldo', category: 'estoque', label: 'Produto sem saldo disponível', description: 'Item por quantidade já movimentado e sem disponível no momento.', priority: 'media', stateful: true, roles: OPS, responsible: false },
  { type: 'estoque.reserva_hoje', category: 'estoque', label: 'Equipamento reservado para hoje', description: 'Reservas confirmadas que começam hoje e ainda não foram entregues.', priority: 'baixa', stateful: true, roles: OPS, responsible: false },
  { type: 'estoque.indisponivel', category: 'estoque', label: 'Equipamento indisponível (danificado ou em manutenção)', description: 'Patrimônio fora de locação.', priority: 'baixa', stateful: true, roles: OPS, responsible: false },
  { type: 'estoque.aguardando_inspecao', category: 'estoque', label: 'Equipamento aguardando inspeção', description: 'Patrimônio retornado aguardando conferência há mais que o período configurado.', priority: 'media', stateful: true, inactivity: 1, roles: [...OPS, 'tecnico'], responsible: false },
  // manutenção
  { type: 'os.nova', category: 'manutencao', label: 'Nova ordem de serviço', description: 'OS aberta.', priority: 'media', stateful: false, roles: ['admin', 'gestor', 'tecnico'], responsible: false },
  { type: 'os.atribuida', category: 'manutencao', label: 'Ordem de serviço atribuída a você', description: 'OS com responsável definido (avisa só o responsável).', priority: 'media', stateful: false, roles: [], responsible: true },
  { type: 'os.sem_movimentacao', category: 'manutencao', label: 'OS sem movimentação', description: 'OS aberta sem mudança de status há mais que o período configurado.', priority: 'media', stateful: true, inactivity: 3, roles: ['admin', 'gestor'], responsible: true },
  { type: 'os.prazo_proximo', category: 'manutencao', label: 'OS com prazo próximo', description: 'Prazo previsto da OS dentro das antecedências.', priority: 'media', stateful: true, leads: [1], roles: ['gestor'], responsible: true },
  { type: 'os.atrasada', category: 'manutencao', label: 'OS atrasada', description: 'OS aberta após o prazo previsto registrado.', priority: 'alta', stateful: true, roles: ['admin', 'gestor'], responsible: true },
  { type: 'os.equipamento_liberado', category: 'manutencao', label: 'Equipamento liberado após manutenção', description: 'Inspeção aprovada após a conclusão da OS.', priority: 'baixa', stateful: false, roles: ['admin', 'gestor', 'estoquista', 'vendedor'], responsible: true },
  { type: 'os.equipamento_parado', category: 'manutencao', label: 'Manutenção mantendo equipamento indisponível', description: 'OS impeditiva aberta há mais que o período configurado.', priority: 'alta', stateful: true, inactivity: 5, roles: ['admin', 'gestor'], responsible: true },
  { type: 'os.encerrada_pendencias', category: 'manutencao', label: 'OS encerrada com pendências', description: 'OS concluída com equipamento ainda não liberado ou serviço de terceiro não enviado ao Financeiro.', priority: 'media', stateful: true, inactivity: 1, roles: ['admin', 'gestor'], responsible: true },
  // logística
  { type: 'logistica.entrega_hoje', category: 'logistica', label: 'Entrega programada para hoje', description: 'Entrega do dia ainda não concluída.', priority: 'media', stateful: true, roles: OPS, responsible: true },
  { type: 'logistica.entrega_proxima', category: 'logistica', label: 'Entrega próxima', description: 'Entrega programada dentro das antecedências.', priority: 'baixa', stateful: true, leads: [1], roles: OPS, responsible: true },
  { type: 'logistica.entrega_atrasada', category: 'logistica', label: 'Entrega atrasada', description: 'Entrega com horário programado já passado e não concluída.', priority: 'alta', stateful: true, roles: OPS, responsible: true },
  { type: 'logistica.retirada_hoje', category: 'logistica', label: 'Retirada/devolução programada para hoje', description: 'Operação de retorno do dia ainda não recebida.', priority: 'media', stateful: true, roles: OPS, responsible: true },
  { type: 'logistica.retirada_proxima', category: 'logistica', label: 'Retirada/devolução próxima', description: 'Retorno programado dentro das antecedências.', priority: 'baixa', stateful: true, leads: [1], roles: OPS, responsible: true },
  { type: 'logistica.retirada_atrasada', category: 'logistica', label: 'Retirada/devolução atrasada', description: 'Retorno programado já passado e não recebido.', priority: 'alta', stateful: true, roles: OPS, responsible: true },
  { type: 'logistica.documento_pendente', category: 'logistica', label: 'Entrega sem comprovante anexado', description: 'Entrega concluída sem foto/comprovante após o período configurado.', priority: 'baixa', stateful: true, inactivity: 1, roles: ['admin', 'gestor', 'estoquista'], responsible: true },
  { type: 'logistica.avaria', category: 'logistica', label: 'Devolução com avaria, falta ou divergência', description: 'Ocorrência registrada aguardando análise.', priority: 'alta', stateful: true, roles: ['admin', 'gestor', 'estoquista'], responsible: false },
  { type: 'logistica.aguardando_inspecao', category: 'logistica', label: 'Equipamentos recebidos aguardando inspeção', description: 'Operação de retorno com itens ainda não inspecionados.', priority: 'media', stateful: true, roles: [...OPS, 'tecnico'], responsible: false },
  // orçamentos
  { type: 'orcamento.aguardando_aprovacao', category: 'orcamentos', label: 'Orçamento aguardando aprovação interna', description: 'Desconto ou regra exige aprovação.', priority: 'media', stateful: true, roles: ['admin', 'gestor'], responsible: false },
  { type: 'orcamento.aguardando_resposta', category: 'orcamentos', label: 'Orçamento aguardando resposta do cliente', description: 'Enviado há mais que o prazo de acompanhamento comercial.', priority: 'baixa', stateful: true, inactivity: 3, roles: [], responsible: true },
  { type: 'orcamento.vencendo', category: 'orcamentos', label: 'Orçamento próximo do vencimento', description: 'Validade da proposta dentro das antecedências.', priority: 'media', stateful: true, leads: [3, 1], roles: [], responsible: true },
  { type: 'orcamento.vencido', category: 'orcamentos', label: 'Orçamento vencido sem resposta', description: 'Proposta expirou sem aprovação ou recusa.', priority: 'baixa', stateful: false, roles: ['gestor'], responsible: true },
  { type: 'orcamento.aprovado_sem_contrato', category: 'orcamentos', label: 'Orçamento aprovado aguardando conversão', description: 'Aprovado pelo cliente e ainda não convertido em venda/contrato após o período configurado.', priority: 'media', stateful: true, inactivity: 2, roles: ['gestor'], responsible: true },
  { type: 'orcamento.convertido', category: 'orcamentos', label: 'Orçamento convertido', description: 'Orçamento convertido em venda ou contrato.', priority: 'baixa', stateful: false, roles: ['gestor'], responsible: true },
  // sistema
  { type: 'sistema.falha_processamento', category: 'sistema', label: 'Falha no processamento de alertas', description: 'Alguma verificação automática falhou (detalhe no log de processamento).', priority: 'critica', stateful: false, roles: ['admin'], responsible: false, critical: true },
];

export const EVENT_BY_TYPE = Object.fromEntries(EVENTS.map((e) => [e.type, e])) as Record<string, EventDef>;

export interface EventSetting {
  event_type: string;
  enabled: boolean;
  leads: number[] | null;
  inactivity_days: number | null;
  roles: Role[];
  notify_responsible: boolean;
  channels: string[]; // 'central' sempre; externos só com provedor configurado
}

export interface NotificationLink {
  module: 'contratos' | 'financeiro' | 'estoque' | 'os' | 'logistica' | 'orcamentos' | 'notificacoes';
  page: string;
  id?: number;
}

export interface NotificationItem {
  id: number; // id do destinatário (leitura é por usuário)
  notification_id: number;
  event_type: string;
  category: Category;
  title: string;
  message: string;
  priority: Priority;
  source_module: string;
  link: NotificationLink | null;
  created_at: string;
  resolved_at: string | null;
  read_at: string | null;
}

export interface ProcessingLog {
  id: number;
  job_type: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: 'executando' | 'sucesso' | 'parcial' | 'erro';
  created_count: number;
  delivered_count: number;
  resolved_count: number;
  error_summary: string | null;
}

export interface NotificationGlobalSettings {
  interval_minutes: number;
  retention_days: number;
}
