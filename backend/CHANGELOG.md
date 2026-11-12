# Changelog — backend

Uma entrada por PR: data, descrição e UC de origem (ver docs/03-requisitos-nao-funcionais.md, seção 3.3.5).

## [Não lançado]

- 2026-11-10 — Camada de acesso a dados: `ClienteProxy` (`POST /executar` com os cabeçalhos da seção 12.3, `X-Timestamp` novo a cada tentativa, prazo por tentativa, repetição só de leituras e de `TOKEN_INVALIDO`), conversões `DECIMAL` ↔ centavos e `snake_case` ↔ `camelCase`, tradução dos erros do proxy e dublê `ProxyClienteFalso` para os testes. Variáveis opcionais `PROXY_URL`, `PROXY_SERVICE_ID` e `PROXY_SERVICE_TOKEN`. Item 2 do TAREFAS.md (RNF05).
- 2026-11-10 — Servidor base: Express com configuração por variáveis de ambiente validadas na subida (`ENV`, `PORT`, `LOG_LEVEL`, `CORS_ORIGENS`), `GET /saude`, erros padronizados `{ codigo, mensagem, detalhes? }` com catálogo de mensagens, log estruturado com máscara de dados sensíveis, `X-Request-Id` por requisição e encerramento gracioso. Item 1 do TAREFAS.md (base para todos os UCs; RNF05).
- 2026-11-04 — Implementação das funções de validação, faturamento, crédito reprovado, frete, estoque, orçamento e fechamento do módulo de cálculo. Módulo de cálculo, VERSAO_REGRAS 1.1.0. UC18, UC19 e UC20.
- 2026-10-19 — Esqueleto do backend (TypeScript, Jest, ESLint, Prettier) e módulo de cálculo: `calcularImpostoItem`, `CalculoError`, constantes de regra. Módulo de cálculo, VERSAO_REGRAS 1.0.0. UC18.
