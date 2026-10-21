# Módulo de Ordens de Serviço (OS) — Central Locadora

Controla manutenções corretivas e preventivas, inspeções, peças, mão de obra, serviços terceirizados, custos e a disponibilidade dos equipamentos. Fica no grupo **Operação** do menu principal, em "Ordens de Serviço".

A antiga aba "Manutenção (OS)", que salvava só no navegador, continua no mesmo grupo como **"Manutenção antiga"**, sem alteração nos dados.

## Onde fica

| Camada | Arquivos |
|---|---|
| Tipos e regras compartilhadas | `shared/os/`: transições, regras por tipo, preventivas, permissões |
| Banco | migração 5 (`modulo_ordens_servico`) em `server/db.ts`; modelo de checklist padrão em `seedOsIfEmpty` |
| Serviços | `server/services/os/`, um arquivo por responsabilidade (tabela abaixo) |
| Rotas | `server/osApi.ts` (`/api/os/...`) |
| Interface | `src/modules/os/`; na ficha do equipamento (Estoque › Equipamentos Individuais), o card "Histórico de manutenção" com o botão "Abrir OS" |
| Testes | `shared/os/rules.test.ts`, `server/os.test.ts` |

Arquivos de `server/services/os/`:

| Arquivo | Responsabilidade |
|---|---|
| `core.ts` | Abertura, edição, bloqueio e custos |
| `materials.ts` | Peças e materiais |
| `labor.ts` | Mão de obra, terceiros e envio ao Financeiro |
| `lifecycle.ts` | Status, checklist, conclusão e liberação |
| `preventive.ts` | Preventivas |
| `queries.ts` | Lista, painel, relatórios, histórico e anexos |

## Tabelas

Criadas:
- `work_orders`: OS com fotografia do equipamento, contrato e cliente (quando locado), plano preventivo, custos previsto e realizado, tempos por status e período de indisponibilidade;
- `work_order_activities`: mão de obra;
- `work_order_materials` e `work_order_material_moves`: peças e cada reserva, retirada, utilização e devolução;
- `work_order_services`: serviços terceirizados;
- `work_order_checklist`: checklist da OS;
- `work_order_attachments`: anexos;
- `work_order_events`: histórico imutável;
- `maintenance_plans` e `maintenance_schedules`: planos preventivos e a programação de cada equipamento;
- `asset_meter_readings`: horímetro e ciclos;
- `checklist_templates`: modelos de checklist.

Alterada: `users`, recriada com o novo perfil **Técnico de manutenção** (`tecnico`). Os usuários existentes foram preservados, e a migração foi testada numa cópia do banco antes.

Reutilizadas, sem duplicar:
- equipamentos e patrimônios (`stock_assets`, `catalog_items`);
- saldo e movimentações do Estoque;
- reservas e inspeção do Estoque;
- contratos (pela reserva em uso);
- fornecedores (`suppliers`);
- contas a pagar do Financeiro;
- numeração (`OS-AAAA-NNNNNN`), auditoria e configurações.

O banco protege o histórico:
- gatilhos impedem excluir OS, eventos, atividades, materiais, movimentações, serviços e anexos;
- OS concluída ou cancelada não tem diagnóstico, custo ou status alterados;
- correções são feitas por estorno, cancelamento ou devolução;
- valores são guardados em centavos inteiros.

## Fluxo de status

Aberta → aguardando avaliação, aprovação, peças ou fornecedor → programada → em execução → em testes → **concluída**. Cancelada é possível a partir de qualquer status aberto.

- **Transições:** só as previstas em `ORDER_TRANSITIONS`. Concluir só é possível a partir de "em testes".
- **Pausas:** pausar por peças, fornecedor ou aprovação exige motivo. O tempo trabalhado (atividades) é preservado.
- **Tempo por etapa:** é acumulado separadamente (aguardando avaliação, aprovação, peças, fornecedor, em execução, em testes), e o tempo efetivo de trabalho vem das atividades.
- **Alçada:** se o custo previsto passar do limite configurado, a OS precisa de aprovação (gestor ou administrador) antes de entrar em execução.
- **Conclusão:** valida, conforme o tipo:
  - diagnóstico (corretiva, avaria, garantia, terceirizado, inspeção);
  - procedimentos executados (atividade, serviço concluído ou descrição);
  - resultado dos testes;
  - checklist obrigatório aprovado (preventiva, inspeção, revisão, ou quando marcado);
  - nenhum material retirado sem registro de utilização ou devolução;
  - nenhum serviço terceirizado em aberto.
- **Tipos extras:** podem ser criados nas configurações, com as próprias exigências.

## Disponibilidade do equipamento

- **Bloqueio só quando necessário:** abrir uma OS não bloqueia o equipamento. Só a OS **impeditiva** bloqueia: marcada na abertura (padrão quando o risco é "alto") ou depois, com justificativa. O equipamento passa a "em manutenção" no Estoque.
- **Travas no Estoque:** com OS impeditiva aberta, o Estoque recusa reserva, entrega e liberação por inspeção. A liberação acontece pela OS.
- **Equipamento locado:** a OS fica vinculada ao contrato. O contrato não é alterado e nenhuma devolução é registrada automaticamente. Reservas futuras afetadas aparecem na OS, mas não são canceladas.
- **Depois da conclusão:** o equipamento vai para "aguardando inspeção". Só volta a ser locável com a inspeção aprovada, pela OS ("Liberar equipamento", checklist de inspeção completo) ou pelo Estoque.
- **Cancelamento:** devolve o equipamento ao estado anterior à OS.
- **Rastreabilidade:** bloqueio, liberação e tempo indisponível ficam no histórico do equipamento e na OS.

## Peças e materiais

| Etapa | Efeito no Estoque |
|---|---|
| Solicitado | nenhum (só a lista de necessidade) |
| Reservado | `stock_balances.reserved`: o saldo fica no local, mas não pode sair para outro uso |
| Retirado | saída real (movimento `consumo_os`) com o custo médio do item |
| Utilizado | nenhum novo efeito; é o que vira custo realizado |
| Devolvido | entrada real (movimento `devolucao_os`) da sobra |

- **Saldo:** respeita as regras do Estoque (sem saldo negativo, salvo item que permite).
- **Retirada e devolução:** levam chave única por envio (reenvio não duplica) e rodam em transação exclusiva (concorrência).
- **Histórico:** as movimentações não são excluídas.
- **Custo:** o realizado é o utilizado vezes o custo médio das retiradas. O previsto usa o custo médio atual.
- **Peça × material:** peça é o item do tipo "peça"; os demais itens de consumo contam como material.
- **Restrições:** patrimônio individual e equipamento de locação não entram como material.

## Mão de obra, terceiros e Financeiro

- **Atividade:** técnico (usuário) ou prestador, início e término, horas, valor por hora e custo. Correção por estorno com motivo.
- **Serviço terceirizado:** previsto → aprovado (gestor ou administrador, com valor aprovado) → concluído (valor realizado e documento). O previsto não conta como realizado.
- **Envio ao Financeiro:** só para serviço concluído. Cria **uma** conta a pagar por serviço (origem `os_servico:<id>`), na categoria de manutenção configurada, sujeita à alçada do próprio Financeiro. Reenviar devolve a mesma conta.
- **Custo × despesa:** peças do estoque e mão de obra interna são custo técnico da OS e não geram nova despesa (a compra das peças já entrou pelo Estoque e pelo Financeiro).
- **Resumo de custos:** previsto × realizado × diferença por componente (peças, materiais, mão de obra, terceiros, outros) e o valor já encaminhado ao Financeiro.

## Preventivas

- **Planos:** por equipamento ou por categoria (todos os equipamentos ativos da categoria, inclusive os cadastrados depois). A periodicidade pode ser em **dias**, **horas de uso** ou **ciclos**. Também guardam checklist, responsável, tempo estimado e antecedência.
- **Medidor:** periodicidade por horas ou ciclos só vale para equipamento com leitura registrada. O sistema não presume horímetro. A leitura é informada na tela de preventivas ou na conclusão da OS.
- **Geração:** uma vez por dia (e pelo botão "Gerar agora"). Índice único por plano, equipamento e vencimento, e nada é gerado se já houver OS aberta do plano.
- **Próxima preventiva:** ao concluir a OS preventiva, a próxima data e o próximo medidor são recalculados pela regra do plano.
- **Alertas:** preventivas próximas ou atrasadas aparecem no painel e no relatório.

## Checklists

- **Modelos:** por categoria de equipamento ou geral, com itens obrigatórios. O modelo padrão "Inspeção geral" vem dos itens de inspeção do Estoque.
- **Respostas:** aprovado, reprovado (exige observação) ou não aplicável (não permitido em item obrigatório), com responsável e data.
- **Itens extras:** podem ser incluídos na OS (peças substituídas, testes finais, condições de segurança).

## Anexos

Fotos do defeito, antes e depois, orçamentos, notas fiscais, laudos, comprovantes e checklists, em PDF ou imagem (até cerca de 1,4 MB). Ficam no banco e só são entregues pela API autenticada: sem link público e sem cache (`Cache-Control: private, no-store`).

## Painel e relatórios

- **Painel:**
  - quantidades de OS: abertas, aguardando atendimento, em execução, aguardando peças, aguardando fornecedor, concluídas no mês, atrasadas;
  - equipamentos indisponíveis;
  - custo realizado no mês (pelas datas de cada lançamento);
  - tempo médio de manutenção.
- **Filtros:** período, equipamento, categoria, responsável, prioridade e status, com pesquisa, ordenação e paginação.
- **Relatórios (exportação CSV):**
  - OS por status, equipamento, técnico e tipo;
  - atrasadas e preventivas programadas;
  - custo por equipamento e por mês;
  - peças mais utilizadas;
  - tempo médio de reparo (total, execução e espera);
  - indisponibilidade;
  - previsto × realizado;
  - reincidência de defeitos (mesmo equipamento e mesma categoria de defeito).
- **Histórico do equipamento:** na ficha do Estoque, com a fotografia gravada em cada OS. Preserva os dados mesmo que o cadastro mude depois.

## Perfis

| Ação | Admin | Gestor | Técnico | Estoquista | Vendedor | Financeiro | Consulta |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Ver OS | ✔ | ✔ | ✔ | ✔ | ✔ (sem custos) | ✔ | ✔ |
| Abrir OS | ✔ | ✔ | ✔ | ✔ | ✔ | — | — |
| Editar, diagnóstico, status, programar | ✔ | ✔ | ✔ | — | — | — | — |
| Aprovar custos e serviços | ✔ | ✔ | — | — | — | — | — |
| Reservar, retirar, devolver material | ✔ | ✔ | ✔ | ✔ | — | — | — |
| Mão de obra | ✔ | ✔ | ✔ | — | — | — | — |
| Encaminhar ao Financeiro | ✔ | ✔ | — | — | — | ✔ | — |
| Concluir e liberar | ✔ | ✔ | ✔ | — | — | — | — |
| Cancelar | ✔ | ✔ | — | — | — | — | — |
| Planos e checklists | ✔ | ✔ | — | — | — | — | — |
| Exportar | ✔ | ✔ | — | — | — | ✔ | ✔ |
| Configurações | ✔ | — | — | — | — | — | — |

As permissões são checadas no servidor. O SQLite não tem permissões por linha: a proteção no banco fica nos gatilhos e nas restrições de integridade. O sistema atende uma única empresa, portanto não há isolamento multiempresa a aplicar.

## Testes

Os 17 cenários obrigatórios estão em `server/os.test.ts`. O 16 (multiempresa) não se aplica e o teste registra isso. O 17 confere que o saldo do Estoque continua igual à soma das movimentações. As regras puras estão em `shared/os/rules.test.ts`.

A suíte completa do projeto tem 152 testes, todos passando, o que confirma que Orçamentos, Estoque, Financeiro e Contratos não regrediram.

## Limitações e próximos passos

- **Equipamentos controlados só por quantidade** (sem patrimônio, ex.: lote de andaimes): não recebem OS. Para esses, segue valendo o indisponível do Estoque (avaria e manutenção na devolução).
- **Fotos por item de checklist:** não há; use os anexos da OS.
- **Peças compradas para uma OS específica:** entram pelo Estoque (entrada de compra) e depois são retiradas na OS. Não há compra direta pela OS.
- **Notificações**: os alertas de OS também aparecem na central de notificações (ver `docs/modulo-notificacoes.md`). E-mail e WhatsApp continuam sem provedor configurado.
- **Manutenção antiga:** os registros do navegador não foram migrados.
