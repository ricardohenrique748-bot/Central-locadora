# Módulo Financeiro — Central Locadora

Contas a pagar e a receber, caixa e bancos, transferências, conciliação bancária, fluxo de caixa e DRE gerencial. Os dados ficam no banco do servidor (`data/central.db`), como em Orçamentos e Estoque.

A antiga aba **Faturamento & Cobrança** continua no menu, sem alterações. Ela ainda salva só no navegador e não conversa com este módulo.

## Onde fica

| Camada | Arquivos |
|---|---|
| Tipos e regras compartilhadas (parcelamento, status, rateio, recorrência, leitura de CSV/OFX, pontuação de conciliação, permissões) | `shared/financeiro/` |
| Banco: migração 3 (`modulo_financeiro`) em `server/db.ts`; carga inicial em `seedFinanceIfEmpty` | |
| Serviços | `server/services/finance/` — `core` (saldo e movimentações), `registry` (contas, categorias, centros de custo, configurações), `entries` (títulos, parcelas, recorrências, anexos), `settlement` (baixas, estornos, comprovante), `treasury` (transferências, abertura e fechamento de caixa), `reconciliation`, `integrations`, `reports` |
| Rotas | `server/financeApi.ts` (`/api/finance/...`) |
| Interface | `src/modules/financeiro/` — submenu **Financeiro** do menu principal |
| Testes | `shared/financeiro/rules.test.ts`, `server/finance.test.ts` |

## Conceitos

- **Título:** uma conta a pagar ou a receber. Situações: rascunho, aguardando aprovação, ativo, cancelado.
- **Parcela:** cada vencimento do título. Situações: aberta, parcial, liquidada, cancelada. "Vencida" é calculada (aberta ou parcial com vencimento antes de hoje), não é gravada.
- **Movimentação:** dinheiro que efetivamente entrou ou saiu de uma conta (pagamento, recebimento, transferência, ajuste de caixa, estorno).
- **Alocação:** liga uma movimentação às parcelas que ela liquida. Um pagamento pode cobrir várias parcelas; uma parcela pode receber vários pagamentos parciais.

**Saldo da conta = saldo inicial + soma das movimentações efetivadas.** Salvar ou lançar um título não mexe no saldo; só a baixa (pagamento ou recebimento) mexe.

Valores são gravados em centavos inteiros. O arredondamento do parcelamento vai para a última parcela.

## Regras principais

- **Nada é apagado.** Títulos são cancelados. Movimentações são corrigidas por **estorno** (somente administrador): uma movimentação inversa vinculada à original, que reabre as parcelas. Estornar duas vezes é bloqueado.
- **Idempotência:** baixas e transferências levam uma chave única por envio. Clique duplo ou reenvio não duplica o lançamento.
- **Pagamento a maior** é bloqueado. Juros, multa e desconto podem ser informados na baixa e ficam registrados na parcela.
- **Saldo negativo:** pagamentos que deixariam a conta negativa são bloqueados, salvo se a configuração permitir.
- **Datas:** não se registra movimentação com data futura nem anterior à data do saldo inicial. O saldo inicial fica travado depois da primeira movimentação.
- **Alçada:** contas a pagar acima do limite configurado ficam "aguardando aprovação" (gestor ou administrador) e só então podem ser pagas.
- **Edição:** título com pagamento registrado ou gerado por integração não é editado; ajustes de vencimento e valor são feitos por parcela, com motivo.
- **Rateio por centro de custo:** opcional; a soma dos rateios precisa fechar o valor do título.
- **Recorrências:** geram títulos até o horizonte configurado (padrão 60 dias). A geração roda uma vez por dia e é idempotente: a mesma data nunca é gerada duas vezes.
- **Transferências:** saída da origem e entrada no destino gravadas na mesma transação. Podem ficar pendentes até a confirmação. Não contam como receita nem despesa.
- **Caixa da loja:** abertura com valor conferido e fechamento com contagem. A diferença vira uma movimentação de "ajuste de caixa", com motivo.

## Conciliação bancária

1. Importar o extrato da conta em **CSV** (colunas data; descrição; valor — aceita `05/10/2026`, `1.500,00`, `-29,90`) ou **OFX**.
2. Linhas já importadas antes são marcadas como **duplicadas** (comparação por conta, data, valor e descrição).
3. Para cada linha, o sistema sugere movimentações da mesma conta e com o mesmo valor, pontuando data (até 5 dias), descrição e referência. Valor igual sozinho nunca concilia.
4. A conciliação automática só acontece se estiver ligada nas configurações **e** houver uma única correspondência exata.
5. Itens que só existem no extrato (tarifa, rendimento, débito automático) podem virar lançamento já liquidado e conciliado, sem duplicidade.
6. Também é possível marcar como divergente, ignorar (com motivo), desfazer e reabrir.

Conciliar não cria receita nem despesa; só confirma que a movimentação do sistema bate com o banco.

## Fluxo de caixa e DRE

- **Realizado:** movimentações efetivadas no período.
- **Projetado (7/15/30/60/90 dias):** saldo atual + parcelas a receber − parcelas a pagar com vencimento de hoje até a data. Valores já vencidos aparecem à parte e não entram na projeção (risco de inadimplência).
- **DRE gerencial:** regime de **competência** (valor dos títulos pela data de competência) ou de **caixa** (pela data do pagamento), filtrável por centro de custo. Cada categoria pertence a um grupo da DRE.
  - Compras de equipamentos para o patrimônio (grupo "Investimento") ficam **fora do resultado** e aparecem em quadro separado.
  - Transferências não entram.
  - É um relatório gerencial, não uma demonstração contábil oficial.

## Integrações

- **Orçamentos → venda:** "Converter em venda" (orçamento de venda aprovado pelo cliente) agora está disponível:
  - baixa no Estoque (movimentação `saida_venda`) dos produtos controlados por quantidade;
  - cria uma conta a receber vinculada ao orçamento, com vencimento em `prazo padrão` dias e a categoria padrão de vendas.
  - Itens controlados individualmente (patrimônio) bloqueiam a conversão: vender patrimônio exige baixa manual no Estoque.
  - Proposta aprovada não gera cobrança; só a conversão gera. A mesma origem nunca gera dois títulos.
  - A tela do orçamento mostra o card "Histórico financeiro" para quem tem acesso ao Financeiro.
- **Estoque → conta a pagar:** entradas de compra confirmadas mostram "Gerar conta a pagar" (ou "Ver no Financeiro", se já existir). O formulário vem preenchido com fornecedor, documento e valor da entrada. Uma entrada gera no máximo uma conta.
- **Contratos:** cada cobrança do cronograma do contrato vira uma conta a receber com origem `contrato:<id>:<cobrança>` (`contractChargeEntryTx`); ajuste e cancelamento só sem recebimento (`adjustContractChargeTx`, `cancelContractChargeTx`). Ver `docs/modulo-contratos.md`.
- **Faturas e Medições** (menu Financeiro › Contas): lista as cobranças dos contratos de locação com a situação do título (`/api/finance/invoices`, exporta CSV). Cada linha abre:
  - a **fatura de locação** em PDF (`server/services/contracts/invoice.ts`), também disponível no detalhe do título vindo de contrato;
  - o **boletim de medição** em PDF (`server/services/contracts/measurement.ts`), só para cobranças de período/valor único. Por item mostra entregue e devolvido no período, dias em uso e diárias (unidades × dia), calculados a partir das entregas e devoluções do contrato (`measurePeriod` em `shared/contratos/rules.ts`). Regra de contagem: o dia da entrega conta e o da devolução não. O valor da medição é o da cobrança, igual ao da fatura; a medição não recalcula preço. Número: `<contrato>-M<nn>`. Traz campos de assinatura para o cliente aprovar.
  - Os dois PDFs também ficam na aba Financeiro do contrato.
- **Ordens de Serviço:** serviço terceirizado concluído pode virar conta a pagar (origem `os_servico:<id>`, uma por serviço). Ver `docs/modulo-ordens-servico.md`.

## Perfis

| Ação | Administrador | Financeiro | Gestor | Consulta | Vendedor / Estoquista |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver o módulo | ✔ | ✔ | ✔ | ✔ (documentos mascarados) | — |
| Lançar títulos, baixar, transferir, conciliar, caixa | ✔ | ✔ | — | — | — |
| Aprovar pagamentos acima da alçada | ✔ | — | ✔ | — | — |
| Estornar | ✔ | — | — | — | — |
| Categorias, centros de custo, contas, configurações | ✔ | — | — | — | — |

O "administrador financeiro" pedido é o perfil **Administrador** já existente. O perfil **Financeiro** foi criado. Todas as regras são checadas no servidor; a interface só esconde os botões.

## Relatórios

Todos com período explícito e exportação em CSV (separador `;`, abre direto no Excel):

- contas a pagar e a receber por período, vencidas, a vencer;
- recebimentos por cliente, pagamentos por fornecedor;
- receitas e despesas por categoria e por centro de custo;
- fluxo realizado e projetado, movimentações por conta, transferências, conciliação;
- inadimplência por faixa de atraso (até 30, 31–60, 61–90, mais de 90 dias);
- DRE gerencial;
- histórico financeiro por venda e por contrato.

## Carga inicial

Na primeira execução, se as tabelas estiverem vazias, são criados:
- o plano de categorias (24, com grupo da DRE);
- 8 centros de custo;
- a conta "Caixa da loja" com saldo R$ 0,00;
- as categorias padrão de venda e de locação.

Nenhum título ou movimentação de exemplo é criado. Antes da migração foi gravado o backup `data/central-backup-antes-financeiro.db`.

## Limitações e próximos passos

- **Exportação:** só CSV (XLSX e PDF dos relatórios não foram feitos). Há comprovante em PDF por movimentação.
- **Boletos, PIX e integração bancária (API/CNAB):** fora do escopo; a conciliação é por arquivo.
- **Caução e indenização de faltantes do Estoque:** ainda não geram títulos automaticamente; lançar manualmente.
- **Faturamento & Cobrança antigo:** mantido como estava; migrar quando for refeito.
- **Anexos:** ficam no banco (até ~1,4 MB cada). Em volume grande, mover para armazenamento de arquivos.

> Alertas deste módulo também são entregues na central de notificações — ver `docs/modulo-notificacoes.md`.
