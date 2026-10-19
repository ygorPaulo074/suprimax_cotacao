# Changelog — proxy

Uma entrada por PR: data, descrição e UC de origem (ver docs/03-requisitos-nao-funcionais.md, seção 3.3.5).

## [Não lançado]

- 2026-10-19 — Proxy implementado ate onde nao depende do banco: autenticacao por token de integrante, escopos, protecao contra replay, rate limit, POST /executar com dados.* (consultar, inserir, atualizar, excluir, lote, rpc), pedido.assumir, orcamento.emitir e resposta.processar (via funcoes do banco), integrante.criar/revogar, verificacao de risco, fila FIFO e auditoria. UC: infraestrutura (RNF05).
