# Módulo de Contratos — Central Locadora

Controla contratos de locação e de venda, do rascunho (manual ou gerado de um orçamento aprovado) até o encerramento. O módulo não guarda estoque nem dinheiro: a disponibilidade vem das reservas do Estoque, e os recebimentos vêm do Financeiro.

A antiga aba "Contratos & Orçamentos" do grupo Comercial ainda salva só no navegador. Ela continua no menu como **"Contratos antigos"**, sem nenhuma alteração nos dados.

## Onde fica

| Camada | Arquivos |
|---|---|
| Tipos e regras compartilhadas (totais, cronograma de cobranças, permissões) | `shared/contratos/` |
| Banco: migração 4 (`modulo_contratos`) em `server/db.ts` | |
| Serviços | `server/services/contracts/`, um arquivo por responsabilidade (tabela abaixo) |
| Rotas | `server/contractsApi.ts` (`/api/contracts/...`) |
| Interface | `src/modules/contratos/`, no submenu **Contratos** do menu principal |
| Testes | `shared/contratos/rules.test.ts`, `server/contracts.test.ts` |

Arquivos de `server/services/contracts/`:

| Arquivo | O que faz |
|---|---|
| `core.ts` | Validação, rascunho, listagem e configurações |
| `lifecycle.ts` | Status, renovação, reajuste, encerramento e rotina diária |
| `operations.ts` | Reserva, entrega e devolução |
| `billing.ts` | Cronograma e cobranças |
| `documents.ts` + `pdf.ts` | Documentos e PDF |
| `reports.ts` | Indicadores, alertas e relatórios |
| `fromQuotation.ts` | Conversão do orçamento |

## Tabelas

Todas as tabelas novas foram criadas na migração 4. A única tabela existente alterada foi `stock_reservations`.

| Tabela | Conteúdo |
|---|---|
| `contracts` | Cabeçalho, condições comerciais, totais calculados, retrato (snapshot) do cliente, datas do ciclo |
| `contract_items` | Itens com retrato do código/descrição, modalidade (locação/venda), patrimônio, preço e desconto |
| `contract_operations` / `contract_operation_items` | Entregas e devoluções. Cada envio tem uma chave única de idempotência |
| `contract_charges` | Cronograma gerado. Cada linha aponta para um título do Financeiro e usa uma chave única por período |
| `contract_amendments` / `contract_terms` | Aditivos (prorrogação, renovação, reajuste) e histórico de vigências/valores |
| `contract_documents` | Contrato, aditivos, comprovantes e anexos, com versão e situação |
| `contract_events` | Histórico imutável (gatilhos impedem alterar ou apagar) |
| `stock_reservations` (alterada) | Novas colunas `contract_id` e `contract_item_id`: a reserva do Estoque continua sendo a fonte da disponibilidade |

O banco também protege o histórico:
- gatilhos impedem excluir contratos, entregas, devoluções, cobranças e documentos;
- correções são feitas por cancelamento, estorno ou aditivo;
- valores são guardados em centavos inteiros (sem ponto flutuante), como no restante do sistema.

Reutilizado, sem duplicar:
- clientes (`customers`);
- itens e patrimônios (`catalog_items`, `stock_assets`);
- reservas, entrega, retorno e inspeção do Estoque;
- conversão idempotente de orçamentos;
- títulos e baixas do Financeiro;
- numeração, auditoria e configurações (`settings`).

## Fluxo de status

```
rascunho → aguardando aprovação → aprovado → aguardando assinatura → (assinatura registrada) → aprovado
        → agendado (início futuro) / ativo → vencido (prazo terminou) → pendente de devolução → encerrado
cancelado: a partir de qualquer status aberto, com justificativa e sem equipamento com o cliente
```

- **Ações permitidas:** cada transição é validada no servidor. A tela mostra só as ações que o servidor libera e explica os bloqueios (ex.: "Ainda há 6 unidades com o cliente").
- **Aprovação:** pode ser exigida para todos os contratos ou só acima de uma alçada. Um aprovador específico pode ser indicado.
- **Assinatura:** registrar a assinatura exige evidência (método, data, quem assinou, descrição). Para via digitalizada, o arquivo é obrigatório. Por padrão, a ativação exige assinatura (configurável).
- **Vigência:** a rotina diária muda **agendado → ativo** no início da vigência e **ativo → vencido** depois do término. "Vencido" é o prazo; "pendente de devolução" é a situação operacional.
- **Reabrir para edição:** só antes da assinatura e sem cobranças geradas. As reservas são liberadas e os documentos anteriores ficam substituídos.

## Estoque

- **Reserva:** é confirmada no Estoque para o período do contrato (prazo indeterminado bloqueia até a devolução). O conflito é revalidado dentro de uma transação exclusiva. Isso impede que duas reservas da mesma unidade passem juntas e que uma quantidade passe da capacidade.
- **Situação do equipamento:** disponível, reservado, alugado, em manutenção e indisponível vêm do próprio Estoque.
- **Entrega:** é a única saída física (`saida_locacao`, ou `saida_venda` para itens vendidos). A reserva, sozinha, não tira nada do estoque. Na entrega, equipamento e saldo são conferidos de novo. A entrega pode ser parcial: a reserva é dividida.
- **Devolução:** total ou parcial.
  - Equipamento individual: volta "aguardando inspeção". Também pode ser classificado na hora como disponível (exige o checklist completo), com avaria (fica danificado) ou para manutenção.
  - Itens por quantidade: separados em devolvidos em ordem, avariados ou para manutenção (voltam indisponíveis) e não devolvidos (registrados para indenização).
- **Encerramento:** por padrão exige que os equipamentos devolvidos tenham sido inspecionados.
- **Ordens de Serviço:** OS impeditiva bloqueia novas reservas e entregas do equipamento; OS aberta para equipamento locado fica vinculada ao contrato, sem alterá-lo (ver `docs/modulo-ordens-servico.md`).

**Logística:** o módulo de Entregas e Devoluções programa, separa, transporta, confirma e inspeciona usando estas mesmas funções físicas (ver `docs/modulo-entregas-devolucoes.md`).

## Financeiro

- **Rascunho não gera cobrança.** As cobranças são lançadas na ativação ou pelo botão "Gerar cobranças".
- **Uma conta a receber por cobrança**, com origem `contrato:<id>:<cobrança>`. A mesma origem nunca gera dois títulos, e cada período tem chave única: reprocessar não duplica.
- **Cronograma:**
  - Periodicidades: diária, semanal, quinzenal, mensal, personalizada (N dias) ou valor único.
  - Cobrança no início ou no fim de cada período.
  - Vencimento em dias após a referência ou em dia fixo do mês.
  - Último período proporcional (opcional).
  - Fretes, taxas e itens vendidos entram uma vez, junto com a primeira cobrança.
  - O dia do término é o dia da devolução e não é cobrado (mesma regra dos orçamentos).
- **Prazo indeterminado:** a rotina diária gera as cobranças até o horizonte configurado (padrão de 3 meses).
- **Recebimentos:** são registrados só no Financeiro. O contrato mostra a situação de cada título (em aberto, vencida, parcial, paga).
- **Ajustes:**
  - ajuste, crédito ou cancelamento de cobrança: só sem recebimento, com justificativa;
  - cobrança extraordinária: com justificativa e chave única por envio.
- **Renovação:** gera as cobranças dos novos períodos.
- **Reajuste:** muda só as cobranças futuras ainda não recebidas.
- **Encerramento:** cancela as cobranças de períodos ainda não iniciados e sem recebimento. As demais seguem em aberto no Financeiro, e é exibido o resumo previsto × recebido × pendente.
- **Cancelamento:** se nada foi entregue, cancela tudo que não teve recebimento. Se houve entrega, cancela só os períodos futuros. Recebimentos nunca são apagados.
- **Categorias:** as categorias padrão de locação e venda são as configuradas no Financeiro.

## Contratos de venda

O fluxo comercial é o mesmo, sem regras de locação:
- sem reserva, sem renovação ou reajuste, sem devolução recorrente;
- pagamento em 1 a 60 parcelas;
- a entrega dá a saída no estoque e o encerramento exige todos os itens entregues.

Venda de patrimônio individual é bloqueada, porque exige baixa patrimonial no Estoque.

Orçamentos de **venda** continuam sendo convertidos pelo módulo de Orçamentos ("Converter em venda"): fluxo existente, não duplicado. Orçamentos de **locação** aprovados geram o contrato em rascunho, pela tela "Gerar a partir de orçamento" ou pelo botão "Converter" do orçamento.

## Documentos

- **Contrato:** gerado após a aprovação, a partir de um **modelo editável** (Configurações). O modelo padrão vem marcado como não validado juridicamente.
- **Aditivos:** emitidos a cada renovação e reajuste.
- **Comprovantes de entrega e devolução:** emitidos a cada operação.
- **Anexos:** PDF ou imagem, até cerca de 1,4 MB.
- **Fotografia dos dados:** cada documento gerado guarda os dados do momento da emissão, e o PDF é refeito sempre a partir dela.
- **Versões:** a nova versão do contrato substitui a anterior ainda não assinada.
- **Situações separadas:** gerado, enviado (com canal) e assinado (com evidência).
- **Assinatura eletrônica:** não há integração. Os campos `signature_provider` e `external_signature_id` estão prontos para uma integração futura, e nenhuma assinatura digital é simulada.

## Alertas, indicadores e relatórios

- **Alertas:** sino "Alertas" no topo do módulo e página própria, com filtros por prioridade, tipo, responsável e data. Cobrem:
  - vencimento (prazos configuráveis, padrão 30, 15 e 7 dias);
  - contratos vencidos com equipamento no cliente e renovações pendentes;
  - entregas e devoluções programadas, devoluções atrasadas;
  - cobranças vencidas;
  - aprovações e assinaturas pendentes;
  - avarias.
- **Painel:** total, em elaboração, aguardando assinatura, ativos, próximos do vencimento, vencidos, encerrados e valor mensal equivalente das locações ativas.
- **Relatórios (exportação CSV):**
  - ativos por período, por cliente, próximos do vencimento, vencidos;
  - encerrados e cancelados, valor contratado por mês, receita recorrente prevista;
  - cobranças em aberto, equipamentos vinculados, devoluções atrasadas;
  - histórico de renovações e reajustes, avarias.
- **Valores separados:** valor contratado, previsto (cronograma) e recebido (Financeiro) aparecem sempre separados.

## Perfis

| Ação | Admin | Gestor | Vendedor | Estoquista | Financeiro | Consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver contratos | ✔ | ✔ | ✔ | ✔ (sem valores) | ✔ | ✔ |
| Criar / editar rascunho | ✔ | ✔ | ✔ (só os seus) | — | — | — |
| Aprovar, registrar assinatura, ativar, renovar, reajustar | ✔ | ✔ | — | — | — | — |
| Reservar, entregar, devolver | ✔ | ✔ | — | ✔ | — | — |
| Encerrar / cancelar | ✔ | ✔ | — | — | — | — |
| Gerar cobranças, ajustes e cobrança extra | ✔ | ✔ | — | — | ✔ | — |
| Gerar documentos | ✔ | ✔ | ✔ | — | — | — |
| Exportar | ✔ | ✔ | — | — | ✔ | ✔ |
| Configurações | ✔ | — | — | — | — | — |

As permissões são checadas no servidor. O SQLite não tem permissões por linha (RLS): a proteção no banco fica nos gatilhos de histórico e nas restrições de integridade. O sistema atende uma única empresa, portanto não há isolamento multiempresa a aplicar.

## Testes

Os 17 fluxos obrigatórios estão em `server/contracts.test.ts`. O 15 (multiempresa) não se aplica e o teste registra isso. Há também testes da rotina diária e dos alertas. As regras do cronograma estão em `shared/contratos/rules.test.ts`. O total do projeto é de 136 testes, todos passando.

## Limitações e próximos passos

- **Inclusão de itens em contrato ativo:** não há aditivo de itens. Use um novo contrato ou reabra antes da assinatura.
- **Periodicidade:** é uma só por contrato, igual para todos os itens.
- **Indenização de faltantes e avarias:** registrada na devolução. A cobrança é lançada como cobrança extraordinária (manual).
- **Caução:** registrada no contrato e no documento, mas não gera título (no plano de contas é um valor a devolver, não receita).
- **E-mail, WhatsApp e assinatura eletrônica:** não implementados. Envio e assinatura são registrados manualmente.
- **Contratos antigos:** os do navegador não foram migrados.

> Alertas deste módulo também são entregues na central de notificações — ver `docs/modulo-notificacoes.md`.
