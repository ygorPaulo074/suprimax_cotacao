# Banco de dados — orientações

**Responsável:** modelagem e administração do banco. **Pasta:** `backend/database/` (Prisma). Os revisores obrigatórios do CODEOWNERS são os donos desta pasta, e toda mudança de schema precisa da aprovação dos responsáveis pelos três sistemas.

## Leia antes de começar

- `docs/13-banco-de-dados.md`: modelo, entidades (13.3), **regras implementadas no banco (13.4)**, segurança e índices (13.5) e dicionário completo (13.7).
- `docs/banco-de-dados/dicionario-de-dados.json`: 22 tabelas, 212 colunas e 45 chaves estrangeiras, prontas para gerar o schema.
- `docs/04-regras-de-negocio.md` (status e transições) e `docs/12-proxy.md` (operações nomeadas e escopos).

## Entregas, em ordem

- [x] **1. Projeto Supabase** (plano gratuito) criado e `DATABASE_URL` configurada no `.env` do proxy; a conexão foi testada e o schema `public` está **vazio**.
- [ ] **1b. Bucket privado** do Supabase Storage para os documentos de crédito.
- [ ] **2. `schema.prisma`** com as 22 tabelas, tipos, chaves primárias/estrangeiras, `UNIQUE` e valores padrão do dicionário. Nomes em `snake_case`, como no dicionário.
- [ ] **3. Migration inicial** gerada pelo Prisma. O Prisma só define e versiona o schema; não consulta dados em produção (o acesso é pelo proxy). Para as migrations use `DIRECT_URL` com o **Session pooler (porta 5432)** ou a conexão direta, e não o Transaction pooler (6543), que o proxy usa e costuma dar problema com migrations. O `migrate dev` precisa de um banco “sombra”: se o Supabase não permitir, gere as migrations num Postgres local.
- [ ] **4. Migration SQL manual** (o Prisma não expressa isto) com as regras da seção 13.4:
  - `CHECK` de valores permitidos (perfis, status, condição de pagamento, prazo do boleto em 10/15/20/28/30, parcelas > 1, CIF sem frete, LGPD, imposto 18%, validade de 30 dias, renegociação ≥ 50%, entrada sem divergência);
  - `sequence` do número do orçamento (BIGINT, sem limite superior);
  - gatilhos: reserva não excede o saldo, orçamento emitido imutável, endereço de entrega do mesmo cliente, cliente inadimplente bloqueia novo orçamento, nova versão marca o original como SUBSTITUIDO, movimentação atualiza o estoque, inativar vendedor com carteira exige novo responsável, bloqueio de login após 3 tentativas;
  - índices da seção 13.5;
  - **RLS ligado em todas as tabelas, sem políticas** (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`): o Supabase expõe o schema `public` por uma API REST própria, e só o proxy (usuário `postgres`, que ignora o RLS) deve acessar os dados.
- [ ] **5. Tabelas do proxy** (colunas em `docs/12-proxy.md`, seções 12.5 e 12.7): `integrantes_proxy` (`escopos` deve ser `text[]`), `log_auditoria` e `fila_escrita`. **São as primeiras a criar**: sem `integrantes_proxy` o proxy não emite o token do backend.
- [ ] **6. Funções do banco** chamadas pelo proxy, com o contrato descrito em `proxy/README.md` (“Contrato com o banco”):
  - `proxy_orcamento_emitir(p_id_orcamento, p_id_operador, p_chave_seguranca)` → `(id_orcamento, numero_orcamento, data_validade)`;
  - `proxy_resposta_processar(p_id_resposta, p_resultado jsonb)` → `(status_orcamento, status_resposta)`;
  - erros de negócio com `RAISE EXCEPTION 'CODIGO'` ou `'CODIGO:{json}'` (`ESTOQUE_INSUFICIENTE`, `ORCAMENTO_NAO_EDITAVEL`, `CHAVE_DUPLICADA`, `RESPOSTA_JA_PROCESSADA`, `PEDIDO_JA_ASSUMIDO`, `NOT_FOUND`).
  - `pedido.assumir` **não** precisa de função: o proxy faz um `UPDATE` condicional.
- [ ] **7. Jobs periódicos** (`pg_cron`, se o plano permitir; senão cron no Render): rascunho expirado após 30 dias e apagado 30 dias depois, orçamento emitido expirado em 30 dias, reservas `EXPIRADA`, protesto após 60 dias sem renegociação.
- [ ] **8. Seed:** um usuário `OPERADOR_CHEFE` inicial e dados de exemplo para desenvolvimento (clientes, produtos com variações, faixas e fardos).
- [ ] **9. Testes das regras do banco** (inserções que devem falhar e passar), rodando contra um banco de teste.
- [ ] **10. Backup manual (dump)** antes de mudanças estruturais e nos marcos do projeto, com o procedimento descrito aqui.

## Definição de pronto

`prisma migrate deploy` num banco vazio cria tudo, o seed roda e os testes de regra passam. O `README.md` desta pasta explica como subir o banco local.

## Dependências

O proxy e o backend só conseguem avançar depois do schema. Ordem de prioridade: **item 5** (tabelas do proxy, para emitir o token do backend), depois os itens 2 a 4 (schema e regras) e o item 6 (funções).
