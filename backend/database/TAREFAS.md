# Banco de dados — orientações

**Responsável:** modelagem e administração do banco. **Pasta:** `backend/database/` (Prisma). Os revisores obrigatórios do CODEOWNERS são os donos desta pasta, e toda mudança de schema precisa da aprovação dos responsáveis pelos três sistemas.

## Leia antes de começar

- `docs/13-banco-de-dados.md`: modelo, entidades (13.3), **regras implementadas no banco (13.4)**, segurança e índices (13.5) e dicionário completo (13.7).
- `docs/banco-de-dados/dicionario-de-dados.json`: 22 tabelas, 212 colunas e 45 chaves estrangeiras, prontas para gerar o schema.
- `docs/04-regras-de-negocio.md` (status e transições) e `docs/12-proxy.md` (operações nomeadas e escopos).

## Entregas, em ordem

- [ ] **1. Projeto Supabase** (plano gratuito) e `DATABASE_URL` no `.env`; bucket privado do Supabase Storage para os documentos de crédito.
- [ ] **2. `schema.prisma`** com as 22 tabelas, tipos, chaves primárias/estrangeiras, `UNIQUE` e valores padrão do dicionário. Nomes em `snake_case`, como no dicionário.
- [ ] **3. Migration inicial** gerada pelo Prisma.
- [ ] **4. Migration SQL manual** (o Prisma não expressa isto) com as regras da seção 13.4:
  - `CHECK` de valores permitidos (perfis, status, condição de pagamento, prazo do boleto em 10/15/20/28/30, parcelas > 1, CIF sem frete, LGPD, imposto 18%, validade de 30 dias, renegociação ≥ 50%, entrada sem divergência);
  - `sequence` do número do orçamento (BIGINT, sem limite superior);
  - gatilhos: reserva não excede o saldo, orçamento emitido imutável, endereço de entrega do mesmo cliente, cliente inadimplente bloqueia novo orçamento, nova versão marca o original como SUBSTITUIDO, movimentação atualiza o estoque, inativar vendedor com carteira exige novo responsável, bloqueio de login após 3 tentativas;
  - índices da seção 13.5.
- [ ] **5. Tabelas do proxy:** `integrantes_proxy`, `log_auditoria` e `fila_escrita` (esquemas em `docs/12-proxy.md`, seções 12.5 e 12.7), combinadas com o responsável pelo proxy.
- [ ] **6. Funções do banco (RPC)** que o proxy chama nas operações nomeadas: `pedido.assumir`, `orcamento.emitir` e `resposta.processar` (transação única, seção 12.8.3).
- [ ] **7. Jobs periódicos** (`pg_cron`, se o plano permitir; senão cron no Render): rascunho expirado após 30 dias e apagado 30 dias depois, orçamento emitido expirado em 30 dias, reservas `EXPIRADA`, protesto após 60 dias sem renegociação.
- [ ] **8. Seed:** um usuário `OPERADOR_CHEFE` inicial e dados de exemplo para desenvolvimento (clientes, produtos com variações, faixas e fardos).
- [ ] **9. Testes das regras do banco** (inserções que devem falhar e passar), rodando contra um banco de teste.
- [ ] **10. Backup manual (dump)** antes de mudanças estruturais e nos marcos do projeto, com o procedimento descrito aqui.

## Definição de pronto

`prisma migrate deploy` num banco vazio cria tudo, o seed roda e os testes de regra passam. O `README.md` desta pasta explica como subir o banco local.

## Dependências

Ninguém depende de você antes dos itens 2 a 4: o proxy e o backend só conseguem avançar depois do schema. Priorize esses.
