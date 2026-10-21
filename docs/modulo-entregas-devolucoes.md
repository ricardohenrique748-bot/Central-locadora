# Módulo de Entregas e Devoluções — Central Locadora

Controla a logística das operações físicas dos contratos:
- programação, separação com checklist e transporte;
- confirmação de entrega, retirada e devolução;
- inspeção dos equipamentos devolvidos, avarias e ocorrências;
- documentos, alertas e relatórios.

Fica no grupo **Operação** do menu principal, em "Entregas e Devoluções".

**Sem duplicar o que já existe.** A movimentação física é a do módulo de **Contratos** (funções `deliverTx` e `returnItemsTx`), que usa as reservas e os movimentos do **Estoque**. Este módulo não tem outro controle de estoque: ele adiciona o fluxo operacional em volta. Os botões "Registrar entrega/devolução" do próprio contrato continuam valendo como atalho, e as duas vias contam o mesmo saldo do contrato.

As antigas abas "Devoluções & Checklist" e "Logística & Pátio", que salvavam só no navegador, continuam no menu como **"... antigos"**, sem alteração nos dados.

## Onde fica

| Camada | Arquivos |
|---|---|
| Tipos e regras compartilhadas | `shared/logistica/`: status, transições, checklist de saída, permissões |
| Banco | migração 6 (`modulo_entregas_devolucoes`) em `server/db.ts` |
| Serviços | `server/services/logistics/` (tabela abaixo) |
| Rotas | `server/logisticsApi.ts` (`/api/logistics/...`) |
| Interface | `src/modules/logistica/` |
| Testes | `shared/logistica/rules.test.ts`, `server/logistics.test.ts` |

Arquivos de `server/services/logistics/`:

| Arquivo | O que faz |
|---|---|
| `core.ts` | Programação, validações, cadastros e anexos |
| `flow.ts` | Separação, saída, confirmação, recebimento, cancelamento e frete |
| `inspection.ts` | Inspeção e ocorrências |
| `reports.ts` | Painel, alertas e relatórios |
| `pdf.ts` | Comprovantes |

## Tabelas

Criadas:
- `logistics_orders`: operação (entrega, retirada ou devolução no balcão), com contrato, endereço específico da operação, transporte, separação, recebimento, custos estimado e realizado, e o vínculo com a movimentação física do contrato (`contract_operation_id`, único);
- `logistics_order_items`: quantidade programada, original, separada, entregue ou recebida, faltante e inspecionada; estado na saída e no retorno; justificativa de ajuste;
- `logistics_inspections`: resultado, checklist, estado, avaria e OS gerada;
- `logistics_occurrences`: avarias, perdas, faltas, divergências e ocorrências de transporte, com análise, responsabilidade, valores estimado e aprovado e vínculo com a cobrança do contrato;
- `logistics_attachments`: fotos e documentos por etapa (saída, entrega, retorno, inspeção, documento) ou por ocorrência;
- `logistics_events`: histórico imutável;
- `logistics_drivers` e `logistics_vehicles`: cadastros.

Alteração em código já existente:
- módulo de Contratos: `deliverTx` e `returnItemsTx` passaram a poder rodar dentro de outra transação, e a devolução por quantidade aceita `held_qty` (item recebido e retido para inspeção);
- o comportamento anterior foi mantido, e os testes de Contratos continuam passando.

O banco protege o histórico:
- gatilhos impedem excluir operações, itens, inspeções, ocorrências, anexos e eventos;
- operação entregue, concluída ou cancelada não muda de status;
- correções são feitas com nova operação (ex.: devolução), nunca apagando a movimentação.

Reutilizados:
- contratos e seus itens;
- clientes (endereço e contato como padrão, sem alterar o cadastro);
- patrimônios, saldos, reservas e inspeção do Estoque;
- OS (abertura automática na manutenção);
- cobrança extraordinária do contrato → Financeiro;
- contas a pagar (frete de transportadora);
- numeração, auditoria e PDF (pdfkit).

## Fluxos

### Entrega

Programada → em separação → pronta para saída → em transporte → **entregue** (ou entregue parcialmente). Cancelada antes da saída física.

- **Programação:**
  - valida o contrato (agendado ou ativo);
  - não deixa programar além do saldo pendente, descontando o que já está em outra operação aberta;
  - recusa equipamento repetido na operação;
  - recusa equipamento em manutenção, em inspeção, com OS impeditiva ou com outra reserva ou locação no período;
  - para itens por quantidade, confere a quantidade livre no período;
  - **não movimenta o estoque**.
- **Separação:**
  - conferência item a item, com estado de conservação;
  - checklist de saída: os itens obrigatórios precisam estar marcados;
  - acessórios e fotos de saída;
  - item faltante, danificado ou indisponível exige **ajuste autorizado** (gestor ou administrador), com justificativa;
  - a disponibilidade é revalidada aqui.
- **Saída e transporte:** horário de saída e chegada, motorista, veículo e ocorrências.
- **Confirmação:**
  - exige o nome de quem recebeu;
  - na mesma transação: revalida e dá a saída física no Estoque (pelo contrato), atualiza a relação equipamento × contrato e o saldo pendente, e grava responsável, data, movimentação e status;
  - se o Estoque recusar, nada é gravado e a operação continua "em transporte";
  - a chave `LOG:<operação>` impede duplicar a saída: clique duplo ou reenvio devolvem "já registrado".
- **Entrega parcial:** o restante continua pendente no contrato e pode ser programado em outra entrega.

### Retirada ou devolução

Programada → em andamento → recebida (ou recebida parcialmente) → em conferência ou aguardando inspeção → **concluída**.

- **Motivos:** fim do contrato, antecipada, substituição, manutenção ou outro.
- **Programação:** limitada ao que está com o cliente (descontando outras retiradas abertas). Agendar não conclui nada.
- **Recebimento:**
  - entrada física única no Estoque, também protegida pela chave `LOG:<operação>`;
  - os itens entram **retidos**: patrimônio fica "aguardando inspeção" e quantidade fica "indisponível";
  - faltantes são registrados e viram ocorrência de divergência;
  - devolução parcial não encerra o contrato, e o saldo com o cliente é recalculado.

### Inspeção (separada da entrada física e da liberação)

| Resultado | Patrimônio | Quantidade |
|---|---|---|
| Aprovado e disponível (checklist completo) | inspeção aprovada no Estoque → disponível (respeita OS impeditiva) | sai do indisponível |
| Aguardando inspeção | continua aguardando | continua indisponível |
| Com avaria / bloqueado | danificado (bloqueado) + ocorrência | continua indisponível + ocorrência |
| Incompleto | continua aguardando + ocorrência | continua indisponível + ocorrência |
| Encaminhado para manutenção | abre **OS impeditiva** (equipamento "em manutenção") + ocorrência | — (fica indisponível) |

- **Comparação saída × retorno:** o estado registrado na entrega original aparece ao lado do estado no retorno, junto com o número da entrega (onde ficam as fotos de saída).
- **Status:** a operação é concluída quando todos os itens recebidos são inspecionados.

## Avarias e ocorrências

Registrada → em análise / aguardando orçamento → aguardando aprovação → aprovada para cobrança → resolvida. Também pode terminar como não passível de cobrança ou ser encaminhada para manutenção.

- **Sem cobrança automática:**
  - a responsabilidade nasce "a apurar";
  - só ocorrências de responsabilidade do **cliente** seguem para aprovação;
  - a aprovação, com valor, é de gestor ou administrador;
  - o envio ao Financeiro é uma ação explícita: lança uma **cobrança extraordinária no contrato** (conta a receber), uma única vez por ocorrência.
- **Evidências:** fotos e documentos por ocorrência.
- **Frete de transportadora:** o custo realizado vira **uma** conta a pagar (origem `logistica:<operação>`, categoria "Frete e transporte"). O custo estimado nunca vira despesa.

## Documentos

PDF da operação, gerado com o pdfkit já usado no sistema:
- comprovante de entrega (ou ordem de separação, antes da entrega);
- comprovante de retirada;
- termo de devolução.

O PDF traz: empresa, número, cliente, contrato, endereço, transporte, equipamentos e quantidades, checklist de saída e de retorno, relatório de avarias e campos de assinatura. A confirmação da entrega também gera o comprovante no módulo de Contratos.

Não há assinatura eletrônica: o comprovante assinado é anexado como foto ou documento. Os anexos só são entregues pela API autenticada, sem link público.

## Alertas, painel e relatórios

- **Alertas:** entregas e retiradas de hoje e atrasadas, devoluções próximas e atrasadas, equipamentos aguardando inspeção, avarias não analisadas, divergências, equipamentos bloqueados, entregas incompletas e entregas sem comprovante anexado. Cada alerta leva à operação.
- **Painel:**
  - entregas: hoje, pendentes, em transporte, entregues no mês;
  - retiradas programadas;
  - devoluções: previstas hoje, atrasadas, aguardando conferência;
  - avarias em aberto e operações com pendências;
  - filtros por período, tipo, status, responsável, motorista, cliente, contrato e equipamento;
  - exportação CSV.
- **Relatórios (CSV):**
  - entregas, retiradas e devoluções por período;
  - operações pendentes;
  - entregas no prazo × atrasadas;
  - devoluções atrasadas;
  - equipamentos com clientes e equipamentos aguardando inspeção;
  - avarias por equipamento e ocorrências por contrato;
  - custos de transporte (estimado × realizado);
  - tempo entre devolução e liberação;
  - operações parciais;
  - divergências.

## Perfis

| Ação | Admin | Gestor | Estoquista | Técnico | Vendedor | Financeiro | Consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver operações | ✔ | ✔ | ✔ | ✔ | ✔ (sem custos) | ✔ | ✔ |
| Programar entrega ou retirada | ✔ | ✔ | ✔ | — | ✔ (só os seus contratos) | — | — |
| Separar, confirmar saída e recebimento | ✔ | ✔ | ✔ | — | — | — | — |
| Ajustar operação | ✔ | ✔ | — | — | — | — | — |
| Inspecionar, registrar avarias e liberar | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Aprovar cobrança | ✔ | ✔ | — | — | — | — | — |
| Enviar ao Financeiro | ✔ | ✔ | — | — | — | ✔ | — |
| Cancelar | ✔ | ✔ | — | — | — | — | — |
| Motoristas e veículos | ✔ | ✔ | — | — | — | — | — |
| Exportar | ✔ | ✔ | — | — | — | ✔ | ✔ |

As permissões são checadas no servidor. A proteção no banco fica nos gatilhos e nas restrições de integridade (o SQLite não tem permissões por linha). O sistema atende uma única empresa.

## Testes

Os 17 cenários obrigatórios estão em `server/logistics.test.ts`:
- o 15 (multiempresa) não se aplica e o teste registra isso;
- o 16 simula falha do Estoque na confirmação e verifica que nada fica inconsistente;
- o 17 percorre entrega, devolução, inspeção e encerramento do contrato.

A suíte completa do projeto tem 166 testes, todos passando (Orçamentos, Estoque, Financeiro, Contratos, OS e Logística).

## Limitações e próximos passos

- **Rastreamento:** não há GPS nem integração com transportadoras (o projeto não tem essa infraestrutura).
- **Assinatura:** não há assinatura eletrônica. Anexe o comprovante assinado.
- **Patrimônio individual não devolvido:** continua com o cliente no contrato. Registre uma ocorrência de perda para análise (a baixa patrimonial fica no Estoque).
- **Equipamentos sem patrimônio definido no contrato:** a entrega exige o patrimônio definido no próprio contrato.
- **Substituição de equipamento:** exige uma retirada e uma nova entrega (ou aditivo no contrato), sem troca automática.
- **Dados antigos:** os registros das abas antigas, salvos no navegador, não foram migrados.

> Alertas deste módulo também são entregues na central de notificações — ver `docs/modulo-notificacoes.md`.
