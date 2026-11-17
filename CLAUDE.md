# SupriMax Cotação — notas para o agente

## Onde está o quê
- Documentação em `docs/` (comece por `docs/README.md`). Fonte de verdade: `docs/01…13`; em conflito com rascunhos, vale o FINAL. Contrato com o frontend: `docs/frontend-api.md`. Fluxo de trabalho: `CONTRIBUINDO.md`.
- Monorepo: `frontend/` (Vite, React, TanStack Query), `backend/` (Express, TypeScript; cálculo em `backend/services/calculo/`; banco, migrations e testes de regra em `backend/database/`), `proxy/`, `scripts/` (seed, definir-senha, gerar-env) e `tests-nfr/` (testes não funcionais).
- Fluxo de dados: navegador → backend → proxy → Supabase (banco e Storage). O frontend nunca fala com o proxy, e o backend nunca fala com o banco nem com o Storage.
- Cada serviço tem `CHANGELOG.md` e `TAREFAS.md`. Listas de tarefas ficam junto do serviço, nunca em `docs/`.

## Regras inegociáveis
- Dinheiro em centavos inteiros; imposto de 18% arredondado uma vez por linha; limites inclusivos (R$ 500 e R$ 1.500).
- Nenhum acesso direto ao banco ou ao Storage: tudo passa pelo proxy (RNF05).
- Orçamento emitido é imutável.
- Segredos só em variáveis de ambiente. Nunca commitar `.env`, `scripts/suprimax_*/` nem `docs/referencias/INFO_SISTEMA*.md` (têm credenciais).

## Perfis
`VENDEDOR`, `OPERADOR`, `OPERADOR_CHEFE`, `FISCAL`, `FINANCEIRO`, `GESTOR` e `ADMIN` (acesso total ao Sistema 2). O backend decide o acesso por `exigirPerfil`; o frontend só oculta. Só `ADMIN` cria, promove, edita ou inativa `ADMIN`.

## Como trabalhar
- `main` protegida: tudo entra por PR. Branch `feature/<serviço>/<tarefa>`; commits pequenos, um por passo (`feat(backend): …`).
- **Todo PR sai direto contra a `main`. Não empilhe PRs** (a base ser outra branch): o projeto usa squash, e mesclar o PR filho depois do pai deixa o código preso na branch antiga.
- Todo PR cita o UC/RF/RNF e atualiza o `CHANGELOG.md` do serviço. Rota ou tipo novo ⇒ atualizar `docs/frontend-api.md` e `frontend/src/api/` no mesmo PR.
- Testes Jest em `*.test.ts` ao lado do código. Antes de enviar, no serviço: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`. Prettier usa LF; em máquina lenta, rode o jest do backend com `--testTimeout=60000`.
- Mudança de schema = migration em `backend/database/prisma/migrations/` mais teste em `database-rules.test.cjs` e aprovação dos responsáveis. O deploy **não** aplica migrations: rode `prisma migrate deploy` (`DIRECT_URL`) depois do merge.
- Variável de ambiente nova ⇒ `config.ts`, `.env.example` do serviço e `render.yaml` (`sync: false` se for segredo).

## Deploy e ambiente
- Render (backend e proxy, plano gratuito: hiberna em 15 min; acorde o proxy antes do backend) e Vercel (frontend; `VITE_API_URL` é lida no build). Todo merge na `main` faz deploy e derruba as sessões (ficam em memória). Implante o proxy antes do backend.
- Docker só pelo terminal Ubuntu (WSL), nunca pelo Docker Desktop.
- Senhas: enquanto o e-mail não existir, use `node scripts/definir-senha.cjs` (simula por padrão; só grava com `--gravar`).
