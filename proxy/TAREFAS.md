# Proxy — orientações

**Responsável:** infraestrutura/DevOps (dono de `/proxy/` no CODEOWNERS). O proxy é um **serviço próprio** (Node.js + TypeScript, Express), hospedado no Render, e o **único** autorizado a acessar o banco. Os backends dos Sistemas 1 e 2 falam com ele; os frontends nunca.

## Leia antes de começar

- `docs/12-proxy.md` inteiro: responsabilidades, contrato, autenticação, segurança, fila de escrita, erros, auditoria e **catálogo de operações (12.8)**.
- `docs/13-banco-de-dados.md` (tabelas e regras que o proxy deve respeitar) e `docs/03-requisitos-nao-funcionais.md` (RNF05, RNF09).

## Entregas, em ordem

- [ ] **1. Base do serviço:** `package.json` (copie a configuração do `backend/`: TypeScript, Jest, ESLint, Prettier), `GET /saude`, leitura das variáveis `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_ADMIN_KEY`, `JWT_SIGNING_SECRET`, `PORT` e `ENV`.
- [ ] **2. Erros:** classe `AppError` e catálogo de mensagens (12.6) com os códigos da tabela 12.8.6; nenhum detalhe interno do banco chega ao cliente.
- [ ] **3. Autenticação:** JWT do integrante (`service_id`, escopos, origens, expiração), cabeçalhos obrigatórios (`Authorization`, `X-Timestamp` com proteção contra replay, `X-Service-Id`, `X-Operation-Id`) e escopos no formato `tabela:acao`, `rpc:<funcao>` e `operacao:<id>`.
- [ ] **4. Envelope `POST /executar`:** `{ operacao, payload }` → `{ ok, dados, ... }`, com validação do payload.
- [ ] **5. Operações genéricas `dados.*`:** `consultar` (filtros, incluir, agregações, ordenação, cursor), `inserir`, `atualizar`, `excluir`, `lote` (atômico, com referência entre passos) e `rpc`. Colunas sensíveis (`senha_hash`, `token_recuperacao_senha`, `validade_token`) nunca são devolvidas sem o escopo `operador.credenciais:consultar`.
- [ ] **6. Verificação de risco estrutural:** bloqueia `atualizar`/`excluir` sem filtro, exclusão em massa e alterações que rompam relacionamentos.
- [ ] **7. Fila de escrita (outbox):** tabela `fila_escrita`, worker FIFO, respostas síncronas ao chamador.
- [ ] **8. Operações nomeadas:** `pedido.assumir`, `orcamento.emitir` e `resposta.processar` (transação única, usando as funções do banco), mais `integrante.criar` e `integrante.revogar` (exigem a `PROXY_ADMIN_KEY`).
- [ ] **9. Auditoria e rate limiting:** log estruturado (winston ou pino) gravado em `log_auditoria`, porque o disco do Render é efêmero; `express-rate-limit`.
- [ ] **10. Testes:** Jest para autenticação, escopos, filtros e fila; em `tests-nfr/`, carga com 10 operadores simultâneos sem perda de dados nem número de orçamento duplicado (RNF09).
- [ ] **11. Deploy no Render** (merge na `main` publica sozinho) e `CHANGELOG.md` mantido a cada PR.

## Definição de pronto

O backend consegue, só com um token de integrante, consultar e gravar em qualquer tabela dentro do escopo, e é bloqueado fora dele. Nenhuma credencial do Supabase sai do proxy.

## Dependências

Precisa do schema e das tabelas do proxy criadas pelo responsável pelo banco. O responsável pelo backend depende dos itens 3 a 5 para começar a integração.
