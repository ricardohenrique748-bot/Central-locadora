# Módulo de Orçamentos — Central Locadora

## Como rodar

```bash
npm install --legacy-peer-deps   # conflito de peer entre esbuild 0.25 e vite 8
npm run dev                      # Express (API) + Vite na porta 3000
npm test                         # testes de cálculo, regras, permissões e fluxo
```

O banco SQLite fica em `data/central.db` (fora do git). Ele é criado e populado na primeira execução com o usuário administrador, os clientes e equipamentos de exemplo do ERP e os modelos de texto. Para outro caminho, use a variável `DB_FILE`. Para produção: `npm run build` e depois `npm start`.

## Arquitetura

| Camada | Onde |
|---|---|
| Regras compartilhadas (cálculo, período de locação, status, permissões, validações) | `shared/orcamentos/` |
| Banco, migrações versionadas, carga inicial | `server/db.ts`, `server/seed.ts` |
| Autenticação (scrypt + cookie httpOnly) e permissões | `server/auth.ts` + `shared/orcamentos/permissions.ts` |
| Serviços (clientes, catálogo, orçamentos, relatórios) | `server/services/` |
| PDF | `server/pdf.ts` |
| Pontos de integração futura | `server/integrations.ts` |
| Interface | `src/modules/orcamentos/` |

A interface usa as mesmas funções de cálculo para mostrar o resumo. Ao salvar, o servidor **sempre recalcula** e ignora os totais enviados pelo navegador. O preço de referência de cada item também é definido no servidor.

## Regras de negócio

**Dinheiro:** centavos inteiros em todo o sistema (sem ponto flutuante).

**Descontos:** o desconto do item incide sobre o bruto do item. O desconto geral incide uma vez sobre o subtotal, que já está com os descontos dos itens.
- Total = subtotal − desconto geral + acréscimos + fretes + montagem + serviços.
- A caução nunca entra no total.

**Desconto efetivo (alçada):** (redução frente ao preço de tabela + descontos dos itens + desconto geral) ÷ valor de tabela. Os limites por perfil ficam em Configurações (padrão: vendedor 5%, gestor 20%, admin 100%). Acima do limite, o orçamento vai para "Aguardando aprovação interna".

**Período de locação:**
- Dias = término − início. Pode ser configurado para incluir o dia final.
- Diária = dias. Semanal = dias ÷ 7. Mensal = dias ÷ dias do mês comercial (padrão 30).
- Sem cobrança proporcional, frações são arredondadas para cima e isso aparece destacado na memória de cálculo. Com cobrança proporcional, fraciona em 2 casas.
- No período "personalizado", o usuário informa a quantidade de períodos.

**Ciclo de vida:**
- Rascunho → (Em revisão) → Aprovado internamente ou Aguardando aprovação → Enviado → (Em negociação) → Aprovado pelo cliente → Convertido.
- Saídas: Recusado (exige motivo), Cancelado (exige justificativa), Expirado (automático quando vence a validade em aprovado/enviado/negociação).
- Só rascunho e "em revisão" são editáveis. Depois disso, a alteração passa por "Criar nova versão". Se o orçamento já foi enviado, a versão anterior fica guardada e a nova precisa ser aprovada e reenviada.
- "Registrar envio" grava uma fotografia da versão emitida. O PDF de cada versão é gerado a partir dela.
- O envio exige o cadastro do cliente completo (CPF/CNPJ, endereço e contato). Rascunhos não exigem.

**Taxa de conversão:** aprovados (cliente ou convertido) ÷ propostas que chegaram a ser enviadas, dentro do mesmo conjunto filtrado (criadas no período).

**Numeração:** `ORC-AAAA-NNNNN`, gerada no servidor dentro de uma transação, com índice único no banco.

**Concorrência:** edições e transições levam `row_version`. Se outra pessoa alterou antes, o servidor responde 409.

## Perfis

| Perfil | Pode |
|---|---|
| Administrador | Tudo, inclusive usuários, alçadas, modelos e dados da empresa |
| Gestor comercial | Vê todos os orçamentos, edita, aprova dentro da alçada, mantém o catálogo, inativa clientes |
| Estoquista | Somente consulta nos orçamentos (opera o Estoque) |
| Vendedor | Cria e acompanha **os próprios** orçamentos; aprova internamente só dentro da alçada (se a aprovação obrigatória estiver desligada) |
| Consulta | Somente leitura |

As permissões são verificadas no servidor. Os botões escondidos na tela são só conveniência.

## Limitações conhecidas

- **Banco:** SQLite local (um servidor). Não há Supabase/RLS porque o projeto não usava. Para vários servidores ou nuvem, migrar as tabelas de `server/db.ts` para Postgres/Supabase.
- **Disponibilidade:** o botão "Verificar disponibilidade" (orçamentos de locação) consulta o módulo de Estoque no período e grava o resultado; não reserva. A reserva é feita no Estoque. Editar o orçamento volta para "não verificada".
- **Conversão:** a conversão em **venda** está disponível: baixa o estoque e gera a conta a receber (ver `docs/modulo-financeiro.md`). A conversão em **contrato de locação** gera o contrato em rascunho, sem reservar nem cobrar (ver `docs/modulo-contratos.md`).
- **Envio por e-mail/WhatsApp:** só prepara a mensagem e baixa o PDF. O usuário anexa, envia e clica em "Registrar envio".
- **Equipes:** não existe o conceito de equipe. O gestor vê todos os orçamentos.
- **Clientes:** os clientes de exemplo foram importados sem CPF/CNPJ, porque os documentos do mock são inválidos (há uma observação no cadastro).
- **Outros módulos:** os módulos antigos do ERP (Contratos, Estoque, Faturamento…) continuam salvos só no navegador e não usam este banco.

## Próximos passos sugeridos

1. ~~Módulo de Estoque~~ — feito (ver `docs/modulo-estoque.md`). O catálogo de itens agora é o cadastro do Estoque.
2. ~~Contratos de locação~~ — feito (ver `docs/modulo-contratos.md`).
3. ~~Financeiro~~ — feito (ver `docs/modulo-financeiro.md`). A caução fica registrada no contrato.
4. Envio automático de e-mail (SMTP) e WhatsApp (API oficial), registrando o envio só após confirmação.
5. Migrar os módulos antigos do `localStorage` para o servidor.

> Alertas deste módulo também são entregues na central de notificações — ver `docs/modulo-notificacoes.md`.
