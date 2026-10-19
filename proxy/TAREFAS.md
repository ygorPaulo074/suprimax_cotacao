# Proxy — orientações

**Responsável:** infraestrutura/DevOps (dono de `/proxy/` no CODEOWNERS). O proxy é um **serviço próprio** (Node.js + TypeScript, Express), hospedado no Render como **Web Service**, e o **único** autorizado a acessar o banco. Os backends dos Sistemas 1 e 2 falam com ele; os frontends nunca.

Uso, contrato e pontos em aberto: [README.md](README.md). Guia para quem consome o proxy: [`../backend/comunicacao-backend-proxy.md`](../backend/comunicacao-backend-proxy.md).

## Leia antes de começar

- `docs/12-proxy.md` inteiro: responsabilidades, contrato, autenticação, segurança, fila de escrita, erros, auditoria e **catálogo de operações (12.8)**.
- `docs/13-banco-de-dados.md` (tabelas e regras que o proxy deve respeitar) e `docs/03-requisitos-nao-funcionais.md` (RNF05, RNF09).

## Situação

A parte que não depende do banco está implementada e testada (83 testes, com banco simulado). Falta o que precisa do schema, o deploy e o teste de carga.

## Entregas

- [x] **1. Base do serviço:** `package.json`, `GET /saude`, leitura das variáveis `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_ADMIN_KEY`, `JWT_SIGNING_SECRET`, `PORT` e `ENV`, mais `DATABASE_URL` (necessária para SQL parametrizado e transações).
- [x] **2. Erros:** `AppError` e catálogo de mensagens (12.6) com os códigos da tabela 12.8.6; nenhum detalhe interno do banco chega ao cliente.
- [x] **3. Autenticação:** JWT do integrante, cabeçalhos obrigatórios (`Authorization`, `X-Timestamp` com proteção contra replay, `X-Service-Id`, `X-Operation-Id`) e escopos `tabela:acao`, `rpc:<funcao>` e `operacao:<id>`.
- [x] **4. Envelope `POST /executar`:** `{ operacao, payload }` → `{ ok, dados, ... }`, com validação do payload.
- [x] **5. Operações `dados.*`:** `consultar` (filtros, incluir, agregações, ordenação, cursor), `inserir`, `atualizar`, `excluir`, `lote` e `rpc`. Colunas sensíveis protegidas.
- [x] **6. Verificação de risco estrutural:** bloqueia `atualizar`/`excluir` sem filtro ou com mais de 50 linhas, e alteração de chave primária.
- [x] **7. Fila de escrita:** FIFO em memória, com o ciclo registrado em `fila_escrita` (padrão outbox).
- [x] **8. Operações nomeadas:** `pedido.assumir` (UPDATE condicional), `orcamento.emitir` e `resposta.processar` (via funções do banco), `integrante.criar` e `integrante.revogar`.
- [x] **9. Auditoria e rate limiting:** pino gravando em `log_auditoria`; `express-rate-limit` por IP.
- [x] **10. Testes (parte unitária e HTTP):** Jest para autenticação, escopos, SQL, risco, fila, operações e erros.
- [x] **Conexão com o Supabase:** `.env` do proxy preenchido; teste de conexão (`SELECT 1`) pelo Transaction pooler (porta 6543) passou. O schema `public` está vazio.

## Pendências

- [ ] **Deploy no Render** (Web Service, Root Directory `proxy`, build `npm ci && npm run build`, start `npm start`, health check `/saude`) com as variáveis de ambiente; merge na `main` publica sozinho.
- [ ] **Testes contra o Postgres real**, quando o banco tiver as tabelas: executor, repositórios, `incluir`, cursor, `UPDATE`/`DELETE` com alias e transações no pooler. Hoje só o texto do SQL foi verificado.
- [ ] **Primeiro integrante:** rodar `integrante.criar` para o Sistema 2 (e depois o Sistema 1) e entregar `service_id` e token ao backend. Exige a tabela `integrantes_proxy`.
- [ ] **Teste de carga** em `tests-nfr/` (k6 ou Artillery): 10 operadores simultâneos sem perda de dados nem número de orçamento duplicado (RNF09). Exige o schema.
- [ ] **Decisões em aberto** (detalhes no `README.md`):
  - atualizar a seção 12.3 da documentação com `DATABASE_URL`;
  - código de erro próprio para violação de regra do banco (hoje `PAYLOAD_INVALIDO`);
  - origem do `id_usuario` na auditoria (hoje nulo);
  - reprocessar itens pendentes da fila após reinício;
  - rate limit compartilhado se houver mais de uma instância.
- [ ] **CHANGELOG** do proxy atualizado a cada PR.

## Definição de pronto

O backend consegue, só com um token de integrante, consultar e gravar em qualquer tabela dentro do escopo, e é bloqueado fora dele. Nenhuma credencial do Supabase sai do proxy.

## Dependências

Precisa do responsável pelo banco: as tabelas `integrantes_proxy`, `fila_escrita` e `log_auditoria`, as funções `proxy_orcamento_emitir` e `proxy_resposta_processar`, e o schema do negócio. O responsável pelo backend já pode usar o guia de comunicação e simular o proxy nos testes.
