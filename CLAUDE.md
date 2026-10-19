# SupriMax Cotação — notas para o agente

- Documentação em `docs/` (comece por `docs/README.md`). Fonte de verdade: `docs/01…13`; em conflito com rascunhos, vale o FINAL.
- Monorepo: `frontend/`, `backend/` (módulo de cálculo em `backend/services/calculo/`), `proxy/`. Ainda não há código.
- Regras inegociáveis: dinheiro em centavos inteiros; imposto de 18% arredondado uma vez por linha; nenhum acesso direto ao banco (sempre via proxy); orçamento emitido é imutável.
- Toda mudança cita o UC e atualiza o CHANGELOG do serviço. Testes Jest em `*.test.ts` ao lado do código.
