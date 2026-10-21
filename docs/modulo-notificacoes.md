# Módulo de Notificações e Alertas — Central Locadora

Central única de avisos gerados automaticamente a partir dos dados reais dos módulos (contratos, financeiro, estoque, OS, entregas/devoluções e orçamentos). Nenhuma notificação é criada manualmente nem para demonstração.

## Onde fica

- **Sino no cabeçalho** (todas as telas): contador de não lidas do usuário (vermelho quando há crítica), painel com as 8 mais relevantes, "Marcar todas como lidas" e "Ver todas". Clicar num aviso marca como lido e abre o registro de origem. Atualiza a cada 60 s.
- **Menu principal → Notificações**, com as abas:
  - **Minhas notificações**: busca, filtros (lidas/não lidas, categoria com contagem, prioridade, pendências atuais / resolvidas / ambas), marcar lida/não lida, marcar todas (ou só da categoria) e "Abrir".
  - **Configurações**: preferências pessoais (silenciar categorias não críticas), canais e alertas da empresa (edição só do administrador).
  - **Processamento** (administrador): log das execuções e "Processar agora".

## Código

| Parte | Arquivo |
|---|---|
| Catálogo de eventos e tipos | `shared/notificacoes/types.ts` |
| Geradores (SQL por módulo) | `server/services/notifications/generators.ts` |
| Motor, configurações, agendador | `server/services/notifications/engine.ts` |
| Central do usuário | `server/services/notifications/center.ts` |
| Rotas `/api/notification-center` | `server/notificationsApi.ts` |
| Sino | `src/components/NotificationBell.tsx` |
| Tela | `src/modules/notificacoes/NotificacoesModule.tsx` |
| Testes | `server/notifications.test.ts` |

## Tabelas (migração 7 `modulo_notificacoes`)

- `notifications`: um registro por ocorrência lógica. `event_key` é **único** (tipo:registro:janela:antecedência) e impede duplicidade. Também guarda categoria, prioridade, origem (módulo/tipo/id), `link` (JSON), `stateful`, `resolved_at` e `expires_at`.
- `notification_recipients`: um registro por usuário, com `read_at` e `delivery_status`. UNIQUE(notification_id, user_id).
- `notification_settings`: configuração por evento: ativo, antecedências, dias de inatividade, perfis, avisar responsável, canais.
- `notification_user_prefs`: categorias silenciadas por usuário.
- `notification_processing_logs`: início e fim, origem (agendado/manual/evento/inicialização), situação (executando/sucesso/parcial/erro), contagens e resumo de erros.

## Eventos

São 40 eventos em 7 categorias. Os padrões estão em `EVENTS` e são todos configuráveis, exceto os críticos.

- **Contratos**: vencendo (7, 3 e 1 dia), vence hoje, vencido sem renovação, devolução hoje, **devolução atrasada (crítico)**, pendência operacional, cobrança vencida.
- **Financeiro**: receber vencendo, recebimento hoje, **receber vencido (crítico)**, pagar vencendo, pagamento hoje, **pagar vencido (crítico)**. Considera só parcelas em aberto ou parciais, portanto título pago nunca gera alerta.
- **Estoque**: abaixo do mínimo e sem saldo (só itens controlados por quantidade, nunca patrimônio individual), reservado para hoje, indisponível (avariado/manutenção), aguardando inspeção.
- **OS**: nova, atribuída a você, sem movimentação, prazo próximo, atrasada (pelo prazo registrado), liberado após manutenção, equipamento parado, encerrada com pendências.
- **Entregas/devoluções**: entrega hoje, próxima e atrasada; retirada hoje, próxima e atrasada; sem comprovante; avaria/falta/divergência; aguardando inspeção.
- **Orçamentos**: aguardando aprovação interna, aguardando resposta do cliente, vencendo, vencido, aprovado sem conversão, convertido.
- **Sistema**: **falha no processamento (crítico)**.

### Regras

- **Antecedência**: o aviso usa a menor antecedência configurada que seja maior ou igual aos dias restantes. Assim, uma execução perdida não deixa de avisar.
- **Avisos de situação** (vencido, atrasado, abaixo do mínimo…) são resolvidos automaticamente quando a condição deixa de existir, por exemplo ao pagar o título ou registrar a devolução. Se a condição volta, o aviso reabre como não lido. A resolução automática só ocorre para tipos cujo gerador rodou sem erro naquela execução.
- **Destinatários**: os perfis configurados, filtrados pelo que cada perfil pode ver. Alertas financeiros só chegam a quem acessa o Financeiro, alertas de sistema só ao administrador, e vendedores recebem apenas o que é deles. O responsável pelo registro também recebe quando "avisar responsável" está marcado. Eventos críticos sempre incluem o administrador e não podem ser desativados nem silenciados.

## Processamento

- Agendador dentro do servidor: confere a cada minuto se já passou o intervalo configurado (padrão 15 min, entre 5 e 1440) e roda 5 s depois que o servidor sobe. Não depende de alguém abrir a tela.
- Também roda por evento: 3 s após qualquer operação gravada com sucesso nos módulos, agrupando operações em sequência.
- Uma trava em memória e no banco (log "executando" com menos de 5 min) impede execuções simultâneas.
- Cada gerador roda isolado. Se um falhar, o log fica "parcial" ou "erro" e o administrador recebe o aviso crítico, enquanto os demais tipos continuam.
- Retenção: avisos resolvidos ou pontuais são apagados após o prazo configurado (padrão 90 dias, entre 7 e 730).

## Canais

Só a **central do sistema** está ativa. E-mail e WhatsApp aparecem como "não configurado", porque não há provedor de e-mail nem integração oficial do WhatsApp Business. Nenhum envio é simulado. Para ativar, falta configurar o provedor (SMTP ou serviço transacional, ou a API do WhatsApp Business) e implementar o envio que use `delivery_status`.

## Permissões

- Cada usuário vê e altera só as próprias notificações. Um id de outro usuário retorna 404.
- Alterar os alertas da empresa, ver o log e processar manualmente: somente o administrador.
- Preferências pessoais: todos os usuários.

## Testes

`server/notifications.test.ts` cobre os 12 cenários exigidos:

1. Antecedência configurável.
2. Título pago sai dos alertas.
3. Devolução registrada encerra o atraso.
4. Não há duplicidade ao reprocessar.
5. Leitura.
6. Contador.
7. Permissões.
8. Agendamento sem abrir a tela.
9. Falha registrada e avisada.
10. Filtros e link.
11. Multiempresa: não se aplica.
12. Sistema sem dados.
