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
7. Para as medições de desempenho/concorrência, ponha `RATE_LIMIT_MAXIMO=1000000` em `proxy/.env` (o padrão de 300/min por IP derruba a carga). Para o teste 15, remova essa linha e reinicie.

Os scripts que usam o banco exigem `DIRECT_URL` com host local (recusam qualquer outro).

## Scripts

| Arquivo | Testes | RNF |
|---|---|---|
| `t01-03-concorrencia.mjs` | 1 (10 operadores emitindo, sem número duplicado), 2 (`pedido.assumir` simultâneo), 3 (reservas concorrentes) | RNF09 |
| `t04-06-desempenho.mjs` | 4 (busca CNPJ), 5 (cálculo 5 itens), 6 (emissão + PDF); p50/p95/p99 | RNF03 |
| `t08-persistencia.mjs gravar` / `ler` | 8 (rascunho sobrevive ao reinício do backend e do proxy) | RNF04 |
| `t11-14-15-seguranca.mjs roles` / `replay` / `ratelimit` | 11 (403 entre papéis), 14 (replay e timestamp), 15 (rate limit) | RNF01, RNF05 |
| `subir-ambiente.sh` | sobe/derruba proxy e backend locais | - |
| `lib.mjs` | utilitários (login, medição, estatística) | - |

Rodar o 8: `node tests-nfr/t08-persistencia.mjs gravar; tests-nfr/subir-ambiente.sh parar; tests-nfr/subir-ambiente.sh; node tests-nfr/t08-persistencia.mjs ler`.
Rodar o 14: exporte `PROXY_SERVICE_ID` e `PROXY_SERVICE_TOKEN` (de `backend/.env` local) e rode `replay`.

Os testes 12 (URL assinada do anexo expira) exige Supabase Storage e não foi automatizado; 13 e 18 são revisões de `render.yaml` e dos `.env.example`.
