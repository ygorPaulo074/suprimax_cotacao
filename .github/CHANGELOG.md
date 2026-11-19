# Changelog — .github (CI)

Uma entrada por PR: data, descrição e UC/RNF de origem.

## [Não lançado]

- 2026-11-18 — CI: novo job `changelog` (falha se um PR altera código de um serviço sem atualizar o `CHANGELOG.md` dele; PR só de `.md` passa; script em `.github/scripts/checar-changelog.sh`), novo job `scripts e tests-nfr` (`node --check` e teste puro de `tests-nfr`), timeouts por job (5 a 15 min) e job agregador `ci` passando a depender também dos dois novos (aceita `skipped` só no `changelog`). Os nomes `ci` e `database` não mudam. Cache do npm, `concurrency` e `permissions: contents: read` já existiam e foram mantidos. RNF de qualidade (docs/03, seção 3.3.2).
