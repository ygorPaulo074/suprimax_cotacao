# Proxy de comunicação

Serviço próprio (Node.js + TypeScript + Express), hospedado no Render, que é o **único** com acesso ao banco compartilhado (Supabase/Postgres). Os backends dos Sistemas 1 e 2 falam com ele; os frontends nunca. Especificação completa: [docs/12-proxy.md](../docs/12-proxy.md). Guia de uso para o backend: [backend/comunicacao-backend-proxy.md](../backend/comunicacao-backend-proxy.md).

```
Backend S1 ─┐
            ├─► POST /executar ─► autenticação ─► escopo ─► risco ─► (fila FIFO) ─► SQL parametrizado ─► Postgres
Backend S2 ─┘                                                          └─► log_auditoria
```

## Como rodar

```bash
npm install
cp ../.env.example .env      # preencha a seção do proxy
npm run dev                  # http://localhost:3001  (GET /saude)
npm run lint && npm run format:check && npm run typecheck && npm test
```

Variáveis (docs/12, seção 12.3): `JWT_SIGNING_SECRET` (≥ 32 caracteres), `PROXY_ADMIN_KEY` (≥ 16), `PORT`, `ENV` (`dev`, `homologacao`, `producao`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e **`DATABASE_URL`** (ver "Pontos em aberto"). Opcionais: `TOLERANCIA_TIMESTAMP_SEGUNDOS` (60), `RATE_LIMIT_JANELA_SEGUNDOS` (60) e `RATE_LIMIT_MAXIMO` (300).

## Contrato

Toda requisição: `POST /executar` com `{ "operacao": "...", "payload": { ... } }` e os cabeçalhos:

| Cabeçalho                       | Uso                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>` | Token do integrante (ou a `PROXY_ADMIN_KEY`, nas operações `integrante.*`)                                                                   |
| `X-Timestamp`                   | ISO 8601 ou milissegundos. Fora da tolerância, ou repetido com o mesmo corpo, é rejeitado (replay). **Em reenvios, gere um novo timestamp.** |
| `X-Service-Id`                  | Mesmo `service_id` do token                                                                                                                  |
| `X-Operation-Id`                | Identifica o processo; vai para a auditoria                                                                                                  |

Resposta de sucesso: `{ "ok": true, ... }`. Erro: `{ "ok": false, "erro": { "codigo", "mensagem", "detalhes?" } }`, com os códigos da seção 12.8.6 (mais `NOT_FOUND`, `INTERNAL_ERROR` e `OPERACAO_NAO_IMPLEMENTADA`, que a seção 12.6 prevê). Nada do banco (tabelas, colunas, mensagens do driver) chega ao cliente.

### Operações

| Operação                                                   | Escopo exigido                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `dados.consultar`                                          | `tabela:consultar` (e de cada tabela em `incluir`); colunas sensíveis só com `operador.credenciais:consultar` |
| `dados.inserir` / `dados.atualizar` / `dados.excluir`      | `tabela:inserir`, `:atualizar`, `:excluir`                                                                    |
| `dados.lote`                                               | os escopos de todos os passos, conferidos antes de executar; transação única                                  |
| `dados.rpc`                                                | `rpc:<funcao>`                                                                                                |
| `pedido.assumir`, `orcamento.emitir`, `resposta.processar` | `operacao:<identificador>`                                                                                    |
| `integrante.criar` / `integrante.revogar`                  | chave mestra                                                                                                  |

Regras: `dados.atualizar` e `dados.excluir` sem filtro, ou que afetariam mais de 50 linhas, são bloqueados (`RISCO_ESTRUTURAL`), assim como alterar chave primária. Tabelas e colunas são validadas contra `src/esquema/dicionario-de-dados.json` (gerado com `npm run esquema:atualizar` a partir de `docs/banco-de-dados/`). Todo valor vai como parâmetro SQL; nenhum entra no texto da consulta.

### Primeiro integrante

```bash
curl -X POST http://localhost:3001/executar \
  -H "Authorization: Bearer $PROXY_ADMIN_KEY" -H "X-Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -H "X-Operation-Id: setup" -H "Content-Type: application/json" \
  -d '{"operacao":"integrante.criar","payload":{"nome_sistema":"Sistema 2","escopos":["*:consultar","*:inserir","*:atualizar","operador.credenciais:consultar","operacao:pedido.assumir","operacao:orcamento.emitir","operacao:resposta.processar","rpc:*"]}}'
```

O token volta **uma única vez**; no banco fica só o hash. Os escopos que valem são os do cadastro (revogáveis sem redeploy), não os gravados no token. Os escopos iniciais de cada sistema estão na seção 12.8.5.

## Contrato com o banco (para o responsável pelo banco)

O proxy usa estas tabelas e funções, que **precisam existir** no banco:

- Tabelas do proxy, com as colunas da documentação (12.5 e 12.7): `integrantes_proxy`, `fila_escrita`, `log_auditoria`. `integrantes_proxy.escopos` deve ser `text[]`.
- `proxy_orcamento_emitir(p_id_orcamento int, p_id_operador int, p_chave_seguranca text)`: executa a emissão numa transação (seção 12.8.3) e devolve uma linha `(id_orcamento, numero_orcamento, data_validade)`.
- `proxy_resposta_processar(p_id_resposta int, p_resultado jsonb)`: grava o resultado da resposta do cliente (seção 12.8.3) e devolve `(status_orcamento, status_resposta)`. `p_resultado` tem o formato do payload de `resposta.processar`.
- **Erros de negócio:** as funções sinalizam com `RAISE EXCEPTION 'CODIGO'` ou `RAISE EXCEPTION 'CODIGO:{"chave":"valor"}'`. Códigos reconhecidos: `ESTOQUE_INSUFICIENTE` (com `produto`, `disponivel`, `quantidade`), `ORCAMENTO_NAO_EDITAVEL`, `CHAVE_DUPLICADA`, `RESPOSTA_JA_PROCESSADA`, `PEDIDO_JA_ASSUMIDO` e `NOT_FOUND`. Outros erros viram `INTERNAL_ERROR`.
- Violação de regra de integridade (SQLSTATE `23xxx`: CHECK, UNIQUE, FK) volta ao cliente como `PAYLOAD_INVALIDO` (400).
- `pedido.assumir` não usa função: é um `UPDATE` condicional em `pedido`.

## O que está pronto e o que falta

Pronto e testado (83 testes, banco simulado): autenticação, escopos, replay, rate limit, geração de SQL, risco, fila FIFO, `dados.*`, lote, rpc, `pedido.assumir`, administração de integrantes, auditoria e tradução de erros.

**Ainda sem teste contra um Postgres real** (aguarda o schema): `src/banco/pg.ts`, os repositórios `*Pg` e as funções do banco acima. O `incluir`, a paginação por cursor e os `UPDATE`/`DELETE` com alias foram só verificados pelo texto do SQL.

## Pontos em aberto

- **`DATABASE_URL`:** a documentação lista só `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, mas o proxy monta SQL parametrizado e transações, o que exige conexão direta ao Postgres (string de conexão do Supabase, de preferência pelo pooler em modo transação). Confirmar e atualizar a seção 12.3.
- **Fila:** o proxy roda uma instância e serializa as escritas em memória; a tabela `fila_escrita` registra o ciclo (padrão outbox), mas não há reprocessamento de itens pendentes após reinício.
- **Rate limit:** por IP, em memória. Em várias instâncias, trocar o armazenamento (ex.: `rate-limiter-flexible` com Redis).
- **`id_usuario` da auditoria:** a documentação não diz de onde vem; hoje fica nulo.
- **Exclusão condicionada (12.8.5):** “`orcamento` em RASCUNHO” é uma condição de dados, não de escopo; deve ser garantida por gatilho no banco.
- **Escopos do Sistema 1 e 3** são propostas ainda não validadas com os grupos.
