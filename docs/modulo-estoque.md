# Módulo de Estoque e Equipamentos — Central Locadora

Fonte oficial de itens, saldos, localização, patrimônio e disponibilidade física. Substituiu a antiga aba "Estoque & Patrimônios" (que salvava só no navegador). Os dados dela foram importados na primeira execução.

## Onde fica

| Camada | Arquivos |
|---|---|
| Regras compartilhadas (estados, conflito de datas, custo médio, rateio, permissões, validações) | `shared/estoque/` |
| Banco: migração 2 em `server/db.ts`; carga inicial em `server/seed.ts` (`seedStockIfEmpty`) | |
| Serviços | `server/services/stock/` — `core` (saldos e movimentações), `registry` (itens, fornecedores, locais, configurações), `documents` (entradas, saídas, transferências), `inventory`, `rental` (patrimônio, reservas, entrega/retorno/inspeção, disponibilidade), `reports` |
| Rotas | `server/stockApi.ts` (`/api/stock/...`) |
| Interface | `src/modules/estoque/` — submenu **Estoque** do menu principal |

O cadastro de itens é **único**: a tabela `catalog_items` atende o Estoque e o catálogo dos Orçamentos. A antiga tela "Produtos e Equipamentos" dos Orçamentos foi removida. Orçamentos emitidos guardam código, descrição e preço do momento e não mudam com alterações no cadastro.

## Regras principais

**Saldo só muda por movimentação.** Cada movimentação confirmada grava o efeito no saldo (`qty_delta` e `unavailable_delta`) na mesma transação que atualiza `stock_balances`. Invariante, verificado nos testes: saldo de item/local = soma dos efeitos das movimentações confirmadas. Movimentações confirmadas não são editadas nem apagadas; a correção é por **estorno** (gestor ou administrador), que cria a movimentação inversa.

**Saldos por item e local:**
- físico;
- reservado;
- indisponível: separado para manutenção ou avaria, ou devolvido avariado de uma locação;
- disponível = físico − reservado − indisponível;
- em trânsito: dentro de transferências enviadas e ainda não recebidas, sem contar em nenhum local;
- com clientes: locações por quantidade em uso, que continuam no patrimônio.

**Controle por item:**
- *Por quantidade*: produtos, peças, consumo e equipamentos a granel (ex.: andaimes).
- *Individual*: cada unidade tem patrimônio próprio, nº de série opcional, custo, situação, histórico, fotos, documentos e QR Code. Só equipamentos e acessórios patrimoniais.

**Estado operacional × situação de locação:**
- **Operacional:** novo, operacional, aguardando inspeção, em manutenção, danificado, baixado. Muda por ações com transições controladas (ver `OPERATIONAL_TRANSITIONS`).
- **Locação** (disponível, reservado, alugado, em trânsito, indisponível): é **derivada**, nunca digitada. Vem do estado operacional, das reservas confirmadas para hoje, das locações em uso e das transferências.
- Danificado não libera direto: precisa passar por manutenção ou avaliação e depois por inspeção.
- Retorno de manutenção vai para "aguardando inspeção".

**Reservas e locação:**
- Datas **inclusivas**: duas reservas conflitam se `início_A ≤ término_B` e `início_B ≤ término_A`. Quem devolve no dia X fica livre a partir de X+1, e só após a inspeção.
- Pendentes e canceladas não bloqueiam a agenda. A confirmação revalida conflitos dentro de transação exclusiva (`BEGIN IMMEDIATE`), então duas confirmações simultâneas não passam juntas.
- Itens por quantidade: a capacidade (físico utilizável + com clientes) é comparada com o pico de uso no período.
- O vendedor só cria reserva pendente; estoquista, gestor e administrador confirmam.
- Orçamento aprovado **não** reserva. A tela do orçamento tem "Verificar disponibilidade", uma consulta que não reserva; a reserva é criada no Estoque e pode ser vinculada ao orçamento.
- Entrega = movimento "saída para locação". Não é venda nem baixa: o patrimônio continua da empresa.
- **Retorno de equipamento individual:** fica "aguardando inspeção". A inspeção tem checklist obrigatório para aprovar, ou manda para manutenção, ou marca como danificado.
- **Retorno por quantidade:** informa devolvidas, avariadas e faltantes. As avariadas voltam como indisponíveis. As faltantes ficam registradas para indenização, a ser tratada no Financeiro.

**Custos:**
- **Custo médio ponderado:** atualizado nas entradas de compra e de implantação, nunca recalculado para trás.
- **Rateio:** desconto e despesas da entrada são rateados pelo valor de cada linha.
- **Três valores separados, nunca somados:**
  - *estoque a custo médio* (produtos, peças, consumo);
  - *patrimônio de locação a custo de aquisição* (sem depreciação; o valor contábil depende do Financeiro);
  - *valor comercial estimado* (saldo × preço de venda).
- **Vendedor não vê custos.**

**Transferências:** rascunho → aguardando envio → em trânsito → recebida, ou cancelada antes do envio.
- **Envio:** tira o saldo da origem, com bloqueio se ultrapassar o disponível.
- **Recebimento:** coloca o saldo no destino.
- **Divergência:** recebido diferente do enviado exige descrição. Patrimônio não recebido fica bloqueado para apuração.

**Inventário:** em andamento → aguardando conferência → aguardando aprovação → finalizado, ou cancelado.
- **Escopo:** local, categoria, tipo, itens ou geral.
- **Abertura:** fotografa o saldo de cada linha e não permite duas contagens abertas do mesmo item/local.
- **Ajuste:** contado − saldo na abertura, aplicado sobre o saldo atual. Assim, movimentações feitas durante a contagem não se perdem nem são contadas em dobro, e as linhas afetadas aparecem sinalizadas.
- **Aprovação:** só gestor ou administrador.
- **Patrimônio individual:** não tem ajuste automático; divergências são tratadas na ficha (transferência ou baixa).

**Baixa patrimonial:** gestor ou administrador, com justificativa e sem reservas abertas. O histórico fica preservado e o equipamento continua consultável.

## Perfis

| Perfil | Estoque |
|---|---|
| Administrador | Tudo, inclusive locais, categorias, unidades e motivos de saída |
| Gestor | Operação completa + aprovar inventário, estorno e baixa patrimonial |
| Estoquista (novo) | Itens, fornecedores, entradas, saídas, transferências, contagem, reservas, entrega, retorno e inspeção. Nos Orçamentos, só consulta |
| Vendedor | Consulta estoque e disponibilidade (sem custos) e solicita reservas |
| Consulta | Somente leitura |

## Carga inicial (dados da aba antiga)

- **Locais:** DEP-01 Depósito principal, PAT-01 Pátio, OFI-01 Oficina.
- **Andaimes e escoras a granel:** entrada inicial de disponível + locado + manutenção/teste. Manutenção/teste ficaram como indisponíveis; o locado virou "locação em uso" de "Clientes diversos (importado)", com datas provisórias.
- **11 patrimônios:** custo estimado pelo valor de reposição do sistema anterior; estados mapeados (locado → alugado, em teste → aguardando inspeção).
- **Backup:** antes da migração foi salvo em `data/central-backup-antes-estoque.db`.

## Limitações e próximos passos

- **Seções a partir da 15 do prompt:** não foram recebidas. O fluxo de devolução e inspeção, os perfis, os relatórios e os testes seguiram o padrão do módulo de Orçamentos.
- **Contratos:** o módulo novo reserva, entrega e recebe a devolução pelas reservas do Estoque (`stock_reservations.contract_id`). Ver `docs/modulo-contratos.md`.
- **Ordens de Serviço:** OS impeditiva aberta bloqueia reserva, entrega e liberação por inspeção do equipamento; peças da OS usam o saldo reservado e os movimentos `consumo_os`/`devolucao_os`. Ver `docs/modulo-ordens-servico.md`.
- **Entregas e Devoluções:** recebimento entra retido para inspeção (patrimônio "aguardando inspeção", quantidade indisponível); a liberação acontece na inspeção. Ver `docs/modulo-entregas-devolucoes.md`.
- **Contratos antigos, Devoluções antigas, Manutenção antiga, Painel Geral e busca rápida antigos:** continuam com os dados próprios no navegador e ainda não leem este estoque. Integrar quando cada módulo for refeito.
- **Vendas:** a conversão do orçamento em venda gera a saída `saida_venda` dos itens por quantidade. Itens individuais (patrimônio) bloqueiam a conversão e precisam de baixa manual.
- **Financeiro:** entradas de compra confirmadas geram a conta a pagar pelo botão "Gerar conta a pagar" (ver `docs/modulo-financeiro.md`). Caução e indenização de faltantes ainda são lançadas manualmente.
- **Arquivos:** fotos e documentos do patrimônio ficam no banco (até ~1 MB cada). Em volume grande, mover para armazenamento de arquivos.
- **Depreciação:** não implementada (o valor contábil depende da política do Financeiro).

> Alertas deste módulo também são entregues na central de notificações — ver `docs/modulo-notificacoes.md`.
