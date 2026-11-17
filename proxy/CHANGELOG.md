# Changelog — proxy

Uma entrada por PR: data, descrição e UC de origem (ver docs/03-requisitos-nao-funcionais.md, seção 3.3.5).

## [Não lançado]

- 2026-11-16 — Corrige ExecutorPg.transacao: AppError de negócio lançado dentro da transação (ex.: PEDIDO_JA_ASSUMIDO, 409) passa intacto após o ROLLBACK, em vez de virar INTERNAL_ERROR (500); só erros do driver são traduzidos. RNF09; sem UC de caso de uso.
- 2026-11-16 — Anexos de orçamento via proxy: operações arquivo.salvar, arquivo.remover e arquivo.assinar sobre o Supabase Storage (bucket privado anexos-orcamento, criado na primeira chamada; caminho montado pelo proxy; limite de 10 MB decodificados), escopos operacao:arquivo.* e limite de corpo de cerca de 14 MB só para arquivo.salvar (1 MB nas demais). UC19, RF11.
- 2026-11-13 — Variáveis de ambiente: `.env.example` próprio do serviço (substitui o da raiz) e deploy no Render via `render.yaml` na raiz. Infra (docs/03, seção 3.2); sem UC.
- 2026-10-19 — Proxy implementado ate onde nao depende do banco: autenticacao por token de integrante, escopos, protecao contra replay, rate limit, POST /executar com dados.* (consultar, inserir, atualizar, excluir, lote, rpc), pedido.assumir, orcamento.emitir e resposta.processar (via funcoes do banco), integrante.criar/revogar, verificacao de risco, fila FIFO e auditoria. UC: infraestrutura (RNF05).
