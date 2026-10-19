# SupriMax — Sistema de Cotação Web (Sistema 2)

Sistema web interno da SupriMax, distribuidora atacadista B2B, para o operador atender os pedidos feitos pelos vendedores no app mobile, montar e emitir orçamentos (PDF) e aplicar automaticamente as regras comerciais: faturamento mínimo, análise de crédito, parcelamento, frete (CIF/FOB) e imposto de 18%.

É um dos três sistemas da solução, todos sobre **um único banco compartilhado**, sempre acessado por um **proxy**:

| Sistema | Papel | Neste repositório |
|---|---|---|
| Sistema 1 | Força de Vendas Mobile (vendedor registra pedidos e respostas do cliente) | Não |
| **Sistema 2** | **Cotação Web (operador monta e emite orçamentos)** | **Sim** |
| Sistema 3 | Painel Gerencial / BI | Não |

```
Frontend S2 (React) ──► Backend S2 (Node/TS + módulo de cálculo) ──► Proxy ──► Supabase (PostgreSQL)
                                  Backend S1 ─────────────────────────┘
```

O frontend só fala com o backend; os backends só falam com o banco através do proxy (RNF05).

## Stack definida

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + TypeScript (inclui o módulo de cálculo, funções puras) |
| Frontend | React |
| Banco | Supabase (PostgreSQL); migrations com Prisma, schema com fonte única neste repo |
| Deploy | Vercel (frontend) + Render (backend e proxy), plano gratuito, deploy a cada merge na `main` |
| Outros | Resend (e-mail), Supabase Storage privado (documentos de crédito), PDFKit/pdfmake (PDF), pg_cron (jobs) |
| Qualidade | ESLint + Prettier, Jest (`*.test.ts` junto ao código), k6/Artillery em `tests-nfr/` |

## Estrutura

```
frontend/                  React + Vite + Tailwind (as 18 telas, camada de API)
backend/                   API do Sistema 2 (a criar)
  services/calculo/        módulo de cálculo — funções puras
  database/                schema Prisma e migrations
proxy/                     proxy central de acesso ao banco (serviço próprio)
tests-nfr/                 testes não funcionais
docs/                      documentação completa (comece por docs/README.md)
.github/CODEOWNERS         revisão obrigatória por pasta (preencher os @times)
.env.example               variáveis de ambiente (nunca commitar .env)
```

## Documentação

Comece por [`docs/README.md`](docs/README.md): índice por tema, ordem sugerida de construção e pontos de atenção. Atalhos:

- Regras comerciais: [`docs/04-regras-de-negocio.md`](docs/04-regras-de-negocio.md)
- Módulo de cálculo (tipos e código TS): [`docs/11-backend-e-modulo-de-calculo.md`](docs/11-backend-e-modulo-de-calculo.md)
- Dicionário de dados (22 tabelas): [`docs/banco-de-dados/`](docs/banco-de-dados/) (JSON e CSV) e seção 13 da documentação
- Marca e telas: [`docs/07-identidade-visual.md`](docs/07-identidade-visual.md), [`docs/10-frontend.md`](docs/10-frontend.md)

## Regras do repositório

Guia completo para quem vai contribuir: [`CONTRIBUINDO.md`](CONTRIBUINDO.md).

- `main` protegida: só entra por Pull Request, com *squash and merge*.
- Branches: `feature/<serviço>/<tarefa>` (ex.: `feature/backend/uc01-gerar-cotacao`).
- Toda PR cita o caso de uso (UC) implementado e atualiza o `CHANGELOG.md` do serviço.
- Revisão: QA roda Jest e revisa, PM aprova, responsável por infra faz o merge.
- Mudança de schema do banco exige aprovação dos responsáveis pelos três sistemas.
