# Testes não funcionais

Performance, concorrência e segurança automatizáveis. Metas: RNF03 (busca CNPJ <= 1 s, cálculo <= 2 s, emissão com PDF <= 5 s), RNF09 (10 operadores simultâneos), RNF01, RNF04 e RNF05 (docs/03-requisitos-nao-funcionais.md).

Os scripts são Node puro (>= 20, `fetch` nativo, sem dependências novas) em vez de k6: assim rodam no Windows sem Docker de rede. Os tempos medidos em máquina local NÃO representam o Render gratuito.

## Pré-requisitos (ambiente 100% local, nunca o Supabase real)

1. Postgres 16 local (exemplo, dentro do Ubuntu/WSL: `docker run -d --name tnf-pg -e POSTGRES_PASSWORD=<senha> -e POSTGRES_DB=suprimax -p 127.0.0.1:55432:5432 postgres:16`). No WSL2 o contêiner só fica de pé enquanto houver uma sessão do Ubuntu aberta.
2. `npm ci` em `proxy/`, `backend/` e `backend/database/`.
3. `export DIRECT_URL=postgresql://postgres:<senha>@127.0.0.1:55432/suprimax` e `(cd backend/database && npx prisma migrate deploy --schema schema.prisma)`.
4. `node scripts/gerar-env.cjs --codename tnf --database-url $DIRECT_URL --direct-url $DIRECT_URL --supabase-url http://127.0.0.1:1 --supabase-service-role-key local` (gera segredos novos em `scripts/tnf_*`, ignorado pelo git). Copie `proxy.env` para `proxy/.env` e `backend.env` para `backend/.env` (apague o valor `PREENCHER` de `RESEND_API_KEY`); em `proxy/.env` aponte `DATABASE_URL` para o Postgres local. Rode `integrantes.sql` no banco.
5. `node scripts/seed-demo.cjs --gravar` (usuários chefe, operador, vendedor1/2, fiscal, financeiro, gestor; senha `Suprimax@2026`).
6. `tests-nfr/subir-ambiente.sh` (proxy :3001, backend :3000; `tests-nfr/subir-ambiente.sh parar` encerra).
7. Para as medições de desempenho/concorrência, ponha `RATE_LIMIT_INTEGRANTE_MAXIMO=1000000` e `RATE_LIMIT_IP_MAXIMO=1000000` em `proxy/.env` (os padrões de 1200/min por integrante e 6000/min por IP podem derrubar a carga). Para o teste 15, troque por `RATE_LIMIT_INTEGRANTE_MAXIMO=60` (e remova a de IP) e reinicie.

Os scripts que usam o banco exigem `DIRECT_URL` com host local (recusam qualquer outro).

## Scripts

| Arquivo                                                  | Testes                                                                                                       | RNF          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| `t01-03-concorrencia.mjs`                                | 1 (10 operadores emitindo, sem número duplicado), 2 (`pedido.assumir` simultâneo), 3 (reservas concorrentes) | RNF09        |
| `t04-06-desempenho.mjs`                                  | 4 (busca CNPJ), 5 (cálculo 5 itens), 6 (emissão + PDF); p50/p95/p99                                          | RNF03        |
| `t08-persistencia.mjs gravar` / `ler`                    | 8 (rascunho sobrevive ao reinício do backend e do proxy)                                                     | RNF04        |
| `t11-14-15-seguranca.mjs roles` / `replay` / `ratelimit` | 11 (403 entre papéis), 14 (replay e timestamp), 15 (rate limit)                                              | RNF01, RNF05 |
| `subir-ambiente.sh`                                      | sobe/derruba proxy e backend locais                                                                          | -            |
| `lib.mjs`                                                | utilitários (login, medição, estatística)                                                                    | -            |

Rodar o 8: `node tests-nfr/t08-persistencia.mjs gravar; tests-nfr/subir-ambiente.sh parar; tests-nfr/subir-ambiente.sh; node tests-nfr/t08-persistencia.mjs ler`.
Rodar o 14: exporte `PROXY_SERVICE_ID` e `PROXY_SERVICE_TOKEN` (de `backend/.env` local) e rode `replay`.

O teste 12 (URL assinada do anexo expira) exige Supabase Storage e não foi automatizado; 13 e 18 são revisões de `render.yaml` e dos `.env.example`.

## Evidência por RNF

Onde cada requisito não funcional (docs/03, seção 3.1) é verificado hoje. "Automatizado" roda sem intervenção; "manual" depende de pessoa e navegador; "pendente" ainda não tem evidência. Os resultados numéricos dependem do ambiente local descrito acima e não valem para o Render gratuito.

| RNF                                                          | Evidência                                                                                                                                                                                                | Tipo             | Situação                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------- |
| RNF01 (senha criptografada, acesso individual)               | `backend/src/modulos/auth/senha.ts` (bcrypt, custo 12) e `senha.test.ts`; `exigirPerfil` com `autenticacao.test.ts`; teste 11 (403 entre papéis) em `t11-14-15-seguranca.mjs roles`                      | Jest + script    | Automatizado                                                                                 |
| RNF02 (no máximo 10 cliques do pedido à emissão com 5 itens) | Nenhuma                                                                                                                                                                                                  | Manual           | Pendente: contar os cliques no navegador e registrar aqui                                    |
| RNF03 (CNPJ 1 s, cálculo 2 s, emissão com PDF 5 s)           | `t04-06-desempenho.mjs` (p50/p95/p99, testes 4 a 6); no backend, `lote.test.ts` conta as chamadas ao proxy no detalhe do orçamento                                                                       | Script + Jest    | Automatizado (local); medir no Render ativo antes de dar por cumprido                        |
| RNF04 (dados salvos não se perdem)                           | `t08-persistencia.mjs gravar` / `ler` (rascunho sobrevive ao reinício do backend e do proxy)                                                                                                             | Script           | Automatizado                                                                                 |
| RNF05 (tudo passa pelo proxy)                                | Teste 14 (replay e timestamp) e 15 (rate limit) em `t11-14-15-seguranca.mjs`; o backend só tem cliente do proxy (`backend/src/dados/`); testes 13 e 18 são revisão de `render.yaml` e dos `.env.example` | Script + revisão | Automatizado em parte; 13 e 18 manuais                                                       |
| RNF06 (fila offline e reenvio)                               | `frontend/src/api/filaOffline.test.ts`; `backend/src/http/middlewares/idempotencia.test.ts` (reenvio sem duplicar)                                                                                       | Jest             | Automatizado; falta teste manual no navegador com a rede cortada (ver `frontend/TAREFAS.md`) |
| RNF07 (host único padronizado)                               | Decisão de infraestrutura (Vercel e Render, docs/03, seção 3.2); `render.yaml`                                                                                                                           | Revisão          | Sem teste                                                                                    |
| RNF08 (Chrome, Edge e Firefox, 1280 px ou mais)              | Nenhuma                                                                                                                                                                                                  | Manual           | Pendente (ver `frontend/TAREFAS.md`)                                                         |
| RNF09 (10 operadores simultâneos, sem número duplicado)      | `t01-03-concorrencia.mjs` (testes 1 a 3)                                                                                                                                                                 | Script           | Automatizado                                                                                 |

O teste 12 (URL assinada do anexo expira) exige Supabase Storage e também não foi automatizado.
