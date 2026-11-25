# Roteiro de apresentação

Apresentação com o sistema **na nuvem**: proxy e backend no Render, frontend na Vercel e banco no
Supabase. Atualizado em 24/11/2026, com a `main` até o PR #80. O que está em "O que já funciona" foi
conferido nessa data no ambiente local, com o seed atual (veja o que **não** foi conferido lá).

> **Se a nuvem falhar na hora, vá direto para [Urgência: rodar local](#urgência-rodar-local).**

## Arquitetura da apresentação

```
Navegador ──► Frontend (Vercel) ──► Backend (Render) ──► Proxy (Render) ──► Supabase
```

| Serviço | Onde | Health check |
|---|---|---|
| Frontend | Vercel (`frontend/`), <https://suprimax-cotacao-tx8y.vercel.app> | abrir a URL |
| Backend (Sistema 2) | Render, serviço `suprimax-cotacao` | <https://suprimax-cotacao.onrender.com/saude> |
| Saúde completa | Backend | <https://suprimax-cotacao.onrender.com/saude/completa> (proxy, leitura e gravação no banco e sessão, uma etapa por linha; `"ok":true` só se todas passam) |
| Proxy | Render, serviço `suprimax-cotacao-proxy` | <https://suprimax-cotacao-proxy-g3eg.onrender.com/saude> |
| Banco | Supabase | — |

Os Sistemas 1 e 3 **não** precisam estar no ar: eles só gravam e leem no mesmo banco.

## Preparação (uma vez, antes do dia)

1. **Gerar os `.env`:** `node scripts/gerar-env.cjs` com as credenciais do Supabase (veja o
   cabeçalho do script). Os valores estão na pasta `scripts/<codename>_<timestamp>_<versao>/`.
   Gerar de novo troca todos os tokens, então use sempre a mesma pasta daqui em diante.
2. **Banco:** `cd backend/database && npm run migrate:deploy`, depois rode o `integrantes.sql` da
   pasta gerada no SQL Editor do Supabase. Sem o SQL, o proxy recusa o token do backend.
3. **Proxy no Render:** crie o serviço pelo `render.yaml` (Blueprint, na raiz) e cadastre as
   variáveis do `proxy.env`. A URL pública é `https://suprimax-cotacao-proxy-g3eg.onrender.com`.
4. **Backend no Render:** cadastre `PROXY_SERVICE_ID` e `PROXY_SERVICE_TOKEN` do `backend.env`,
   `PROXY_URL` = a URL do proxy do passo 3 e `CORS_ORIGENS` = `https://suprimax-cotacao-tx8y.vercel.app` (a URL da Vercel do passo 5), **sem
   barra final**. A URL do backend é `https://suprimax-cotacao.onrender.com`.
5. **Frontend na Vercel:** projeto com *Root Directory* `frontend` e a variável
   `VITE_API_URL` = a URL do backend do passo 4. A Vercel lê essa variável **na hora do build**:
   se mudar, faça um novo deploy. As duas URLs dependem uma da outra: crie o projeto da Vercel
   primeiro para saber a URL, preencha o `CORS_ORIGENS` e só então faça o deploy final.
6. **Dados de demonstração** (roda da sua máquina, grava direto no Supabase):
   ```
   node scripts/seed-demo.cjs --simular                  # valida sem gravar
   node scripts/seed-demo.cjs --gravar --apagar-tudo     # APAGA tudo e grava de verdade
   ```
   Precisa de `npm ci` em `proxy/` e `backend/` na sua máquina. **Atenção:** o script apaga todos os
   dados das tabelas (exceto `integrantes_proxy`, que guarda as credenciais do backend no proxy) e
   popula todas com exemplos de demonstração; todos os usuários são desconectados. Repetir é seguro:
   o resultado é sempre o mesmo conjunto de dados.

A nuvem só publica o que está na `main`. Código que não foi mesclado não aparece na apresentação.

### O que o seed cria

O seed **apaga todos os dados** (menos `integrantes_proxy`) e popula as 25 tabelas, com um exemplo de
cada situação. Tudo é fictício. Detalhes no cabeçalho de `scripts/seed-demo.cjs`.

- **Usuários** (senha de todos: `Suprimax@2026`): `chefe` (operador chefe), `operador`, `vendedor1`,
  `vendedor2`, `fiscal`, `financeiro`, `gestor`, `adm` (administrador) e `inativo` (não consegue entrar).
- **9 clientes** em situações diferentes: ativos (mercearia, restaurante, padaria, hotel matriz e filial),
  um com dívida em aberto e protestada (`Empório Atraso`), um com dívidas renegociada e quitada
  (`Bar do Zé`), um inativo e um bloqueado.
- **3 fornecedores** e **9 produtos** (um inativo) com marca, embalagem, 3 faixas de preço, fardo de 6
  unidades e estoque. O `DEMO-CAFE-500` fica **sem estoque** de propósito, para mostrar o bloqueio.
- **7 pedidos**, um por status, e **12 orçamentos** cobrindo todos os status (rascunho, pendente de
  crédito, aberto, alteração solicitada, aceito, recusado, substituído, cancelado e expirado), com
  respostas, reservas, histórico, anexos, análises de crédito, dívidas e movimentações de estoque.
- Os orçamentos emitidos têm número (`00001` em diante) e o PDF pode ser gerado.

O prefixo `DEMO-` nos produtos e nos números de solicitação identifica o que o seed criou.

## Na hora (checklist de 10 minutos antes)

1. **Acorde os dois serviços do Render, proxy primeiro.** No plano gratuito eles hibernam depois de 15
   minutos sem uso, e acordar leva de 20 a 60 segundos (medido: cerca de 22 s para o proxy). Abra `/saude`
   do proxy e depois `/saude` do backend até responderem. A ordem importa: o backend espera só 10 segundos
   por tentativa ao falar com o proxy, então com o proxy dormindo o login falha.
   A **página de aguardo** do sistema faz essa checagem sozinha: em produção, ao abrir o sistema, ela
   mostra "Verificando os serviços" e só libera quando servidor, proxy, banco (leitura e gravação) e login
   (sessão) passam. Se algum item não passar, ela diz qual. A liberação vale 10 minutos na aba.
2. **Não mescle nada na `main` durante a apresentação nem nos minutos antes.** Todo merge refaz o deploy do
   backend e do proxy, e o proxy fica fora do ar por alguns minutos (já levou perto de 5). Espere o deploy
   terminar e confira a página de aguardo.
3. **Entre com o `operador` e o `chefe` com antecedência** e deixe a sessão aberta. As sessões ficam no banco
   quando `SESSOES_NO_BANCO=true` no backend (confirme no Render): nesse caso, deploy e reinício não
   deslogam. Rodar o seed desconecta todo mundo.
4. **O bloqueio de login é de 3 tentativas inválidas, por 15 minutos** (UC13). Se travar, limpe no SQL Editor
   do Supabase: `UPDATE operador SET tentativas_login_invalidas = 0, bloqueado_ate = NULL;`
5. **Não use e-mail.** Enviar o orçamento por e-mail e recuperar senha dependem do provedor, que **não está
   configurado em produção** (o envio responde 503 ou só registra em log). Para trocar uma senha, use
   `node scripts/definir-senha.cjs` (simula por padrão; só grava com `--gravar`).
6. **Mantenha os serviços acordados só na janela da apresentação.** O plano gratuito dá 750 horas por mês,
   somadas entre os serviços; backend e proxy sempre acordados gastam 48 h por dia (cerca de 15 dias). Se usar
   um cron para acordá-los, o intervalo tem de ser de **no máximo 10 minutos** e ele tem de chamar os **dois**
   serviços (`POST /jobs/executar` do backend já chama o proxy por dentro). Ligue um ou dois dias antes e
   desligue depois.

## O que já funciona

As 17 telas do `docs/frontend-api.md` têm rota no backend. Cada perfil enxerga só o que lhe cabe;
`vendedor1`, `vendedor2` e `gestor` entram, mas caem em "sem acesso" (o Sistema 2 é do operador).

| Fluxo | Perfil | Para mostrar com o seed |
|---|---|---|
| Login, sessão e logout (UC13) | todos | senha errada mostra "Usuário ou senha inválidos."; `inativo` é recusado |
| Fila e análise de pedidos (UC10) | `operador`, `chefe` | 3 pedidos solicitados (`PED-0001` a `PED-0003`) |
| Clientes: busca, ficha, cadastro (UC02, UC03) | `operador`, `chefe` | CNPJ `11222333000181`; `Empório Atraso` tem dívida e não aceita orçamento |
| Orçamentos: montar, bloqueios, emitir, PDF (UC01, UC14 a UC19, UC08) | `operador`, `chefe` | a lista traz um orçamento em cada status |
| Respostas pendentes (UC21) | `operador`, `chefe` | 1 resposta pendente (o menu mostra o contador) |
| Análise de crédito (UC07) | `fiscal` | 1 análise pendente (a padaria) e 2 já decididas |
| Dívidas (UC23) | `financeiro` | 4 dívidas, uma em cada situação |
| Produtos (UC04): lista, cadastro, edição | `operador`, `chefe` | faixas e fardos só o `chefe`; `DEMO-CAFE-500` sem estoque |
| Estoque (UC24) e entrada de mercadoria | `chefe` (ajuste); `operador`, `chefe` (entrada) | saldo de cada variação |
| Fornecedores (UC22) | `chefe` (o `operador` só lista) | 3 fornecedores |
| Usuários (UC25) | `chefe`, `adm` | 9 usuários, um por perfil e um inativo |

**O que foi conferido** (24/11, ambiente local, seed atual): o roteiro `node scripts/demo-fluxo.mjs --executar`
passa inteiro (login, sessão, ficha do cliente, busca de produtos, rascunho, bloqueio por estoque, item,
condições, emissão, PDF e logout), e as telas acima abrem com o perfil indicado. **Não foi conferido de ponta a
ponta**: tratar uma resposta, registrar o resultado de uma análise de crédito, registrar dívida, entrada de
mercadoria, ajuste de estoque, aprovar ou negar pedido e enviar por e-mail. Ensaie antes o que for mostrar.

Sugestão de roteiro (é o que o `demo-fluxo` percorre, com o `operador`): entrar → buscar o cliente
`11222333000181` → criar um orçamento → tentar o `DEMO-CAFE-500` (recusado por falta de estoque) → adicionar
30 unidades do `DEMO-ARROZ-5` (R$ 840,75, acima do mínimo de R$ 500) → definir pagamento e frete (frete FOB da
SupriMax precisa do valor, senão a emissão fica bloqueada) → emitir → abrir o PDF → sair. Depois: `chefe`
(produtos, estoque e usuários), `fiscal` (crédito) e `financeiro` (dívidas). **Emitir é definitivo**: o
orçamento fica imutável e consome um número.

## O que NÃO mostrar

- **Enviar por e-mail e recuperar senha** (sem provedor em produção, veja o checklist).
- **Ações que nenhum teste de ponta a ponta cobriu**, listadas acima: ensaie na nuvem antes ou deixe de fora.
- **Recarregar a página (F5) com um formulário preenchido**: o aviso de "não salvo" existe, mas o ensaio é
  mais seguro sem isso.
- **Clicar duas vezes em "Salvar dados" enquanto a primeira gravação não terminou** (leva uns 4 s no Render):
  a edição do segundo clique pode se perder.
- **Mesclar na `main` ou deixar o Render hibernar** durante a apresentação.

O módulo de cálculo (`backend/services/calculo`) está ligado às rotas de orçamento: os totais, o imposto de 18%
e os bloqueios de emissão vêm dele. Para mostrar a parte pura, rode os testes:
`cd backend && npx jest services/calculo`.

## Se algo falhar na nuvem

| Sintoma | Causa provável |
|---|---|
| Frontend demora ou mostra erro de rede no primeiro login | Render hibernado. Espere e tente de novo (veja o checklist). |
| Erro de CORS no console do navegador | `CORS_ORIGENS` do backend diferente da URL da Vercel (barra final, `http` em vez de `https`). |
| Frontend chama `localhost:3000` | `VITE_API_URL` não estava definida no build da Vercel: defina e faça novo deploy. |
| Backend no Render não sobe (log com "Configuração inválida") | Falta `PROXY_URL`, `PROXY_SERVICE_ID`, `PROXY_SERVICE_TOKEN` ou `CORS_ORIGENS`, ou alguma tem valor de exemplo/`localhost`. |
| `TOKEN_INVALIDO` nos logs | O `integrantes.sql` não foi rodado, ou os tokens do Render são de outra geração do `gerar-env`. |
| Proxy não sobe | `PROXY_ADMIN_KEY` ou `JWT_SIGNING_SECRET` curtos ou ausentes, ou `DATABASE_URL` vazia. |
| Todos deslogados do nada | O seed foi rodado, ou `SESSOES_NO_BANCO` não está `true` no backend (sessões em memória). Entre de novo. |
| Login sempre falha | Seed não rodou, ou a conta foi bloqueada (3 tentativas). |
| "Serviço temporariamente indisponível" ao entrar, ou a página de aguardo não libera | Proxy ou banco fora. Abra `/saude/completa` do backend: a etapa com `"ok":false` diz o que falhou. Proxy hibernado ou deploy em andamento passam sozinhos em até alguns minutos. |
| Cadastro de produto recusado com "Os dados enviados são inválidos." | A tela marca o campo recusado (NCM com 8 dígitos, EAN de 8 a 14, estoque até 2.147.483.647, categoria até 60 caracteres). |

## Urgência: rodar local

Use se a nuvem não responder. O banco continua sendo o Supabase (para ensaiar sem mexer na nuvem, use a seção
**Rodar tudo local, com banco local**, mais abaixo); sobem **três serviços**, nesta
ordem. O backend só funciona com o proxy no ar, e o frontend só funciona com o backend.

| Ordem | Serviço | Pasta | Porta | Comando |
|---|---|---|---|---|
| 1 | Proxy | `proxy/` | 3001 | `npm run dev` |
| 2 | Backend | `backend/` | 3000 | `npm run dev` |
| 3 | Frontend | `frontend/` | 5173 | `npm run dev` |

Antes (ideal: já deixar pronto no dia anterior):

1. `npm ci` em `proxy/`, `backend/` e `frontend/`.
2. Cada serviço tem **um só `.env`** (`proxy/.env`, `backend/.env`, `frontend/.env`) e um
   `.env.example`. Os `.env` do repositório estão com os valores da **nuvem**.
3. Para rodar local, ajuste os `.env` (e **volte** os valores da nuvem depois, se for reenviar ao
   Render): em `backend/.env`, `ENV=dev`, `PROXY_URL=http://localhost:3001`,
   `CORS_ORIGENS=http://localhost:5173` e `TRUST_PROXY=0`; em `proxy/.env`, `ENV=dev`; em
   `frontend/.env`, `VITE_API_URL=http://localhost:3000`. Não é preciso definir `PORT`: os padrões
   são 3001 (proxy) e 3000 (backend).
4. O seed e o `integrantes.sql` já valem: são do mesmo Supabase.

Depois abra <http://localhost:5173>. Não edite arquivos do backend durante a apresentação: o
`tsx watch` reinicia e derruba as sessões.

## Rodar tudo local, com banco local (sem tocar na nuvem)

Use para desenvolver, testar ou ensaiar sem depender do Render, da Vercel nem do Supabase. É diferente de
"Urgência: rodar local", que usa o banco da nuvem e manda editar os `.env` (que trazem valores da nuvem).
Aqui **nenhum `.env` do repositório é alterado**: o proxy e o backend leem os arquivos gerados direto da
pasta `scripts/local_*/`.

Pré-requisitos: Node 20 ou mais novo e `npm ci` em `proxy/`, `backend/`, `backend/database/` e
`frontend/`. O Docker só roda pelo terminal Ubuntu (WSL), nunca pelo Docker Desktop. Os comandos abaixo
são de bash (Git Bash ou Ubuntu), a partir da raiz do repositório. No PowerShell, troque
`export NOME=valor` por `$env:NOME = 'valor'`.

1. **Postgres local** (no terminal Ubuntu):
   ```
   docker run -d --name suprimax-local -e POSTGRES_PASSWORD=<senha> -e POSTGRES_DB=suprimax -p 127.0.0.1:55432:5432 postgres:16
   ```
   No WSL2, o contêiner só fica de pé enquanto houver uma sessão do Ubuntu aberta.
2. **Aponte a conexão para ele, neste terminal, antes de qualquer outro comando:**
   ```
   export DIRECT_URL="postgresql://postgres:<senha>@127.0.0.1:55432/suprimax"
   ```
   **Cuidado:** `backend/database/.env` e a pasta `scripts/suprimax_*/` têm a conexão do **Supabase**. Variável
   já definida no terminal vence o `.env`, e por isso o passo 3 confere o destino antes de gravar.
3. **Migrations.** Confira que o destino é o banco local e só então aplique:
   ```
   cd backend/database
   npm run migrate:status     # a linha "Datasource" tem de mostrar 127.0.0.1:55432. Se mostrar o Supabase, PARE.
   npm run migrate:deploy
   cd ../..
   ```
4. **Gere os `.env` locais** (ficam em `scripts/local_<data>_v1/`, fora do git, com segredos novos):
   ```
   node scripts/gerar-env.cjs --codename local --database-url "$DIRECT_URL" --direct-url "$DIRECT_URL" --supabase-url http://127.0.0.1:1 --supabase-service-role-key local
   ```
   Abra `backend.env` da pasta gerada e **apague a linha `RESEND_API_KEY=PREENCHER`**. Com ela, o backend
   entende que o e-mail está configurado e não sobe ("EMAIL_REMETENTE ... é obrigatória quando
   RESEND_API_KEY está configurada"). Sem a linha, o e-mail só é registrado em log.
5. **Registre os integrantes do proxy** (sem isto o proxy recusa o token do backend):
   ```
   node -e "const fs=require('fs');const {Client}=require('./proxy/node_modules/pg');(async()=>{const c=new Client({connectionString:process.env.DIRECT_URL});await c.connect();await c.query(fs.readFileSync(process.argv[1],'utf8'));await c.end();console.log('integrantes registrados')})()" scripts/local_<data>_v1/integrantes.sql
   ```
6. **Dados de demonstração** (apaga e popula o banco **local**, que está em `DIRECT_URL`):
   ```
   node scripts/seed-demo.cjs --gravar --apagar-tudo
   ```
   Confira que a linha `Banco:` mostra `127.0.0.1:55432`. Sem `DIRECT_URL` definida, o script usa a pasta de
   `.env` mais recente por ordem alfabética, que pode ser a da nuvem.
7. **Suba os três serviços, cada um em um terminal, nesta ordem** (troque `<data>` pela pasta gerada):

   | Ordem | Serviço | Porta | Comando |
   |---|---|---|---|
   | 1 | Proxy | 3001 | `cd proxy && npx tsx --env-file=../scripts/local_<data>_v1/proxy.env src/index.ts` |
   | 2 | Backend | 3000 | `cd backend && npx tsx --env-file=../scripts/local_<data>_v1/backend.env src/index.ts` |
   | 3 | Frontend | 5173 | `cd frontend && VITE_API_URL=http://localhost:3000 npx vite --port 5173` |

   O proxy leva uns 15 segundos para responder na primeira vez (compilação do `tsx`). A `VITE_API_URL` dada
   na linha vence a do `frontend/.env`, que aponta para o Render. Não use `npm run dev` nos dois primeiros:
   ele lê o `.env` do repositório, com valores da nuvem.
8. **Confira.** A saúde completa tem de passar nas cinco etapas:
   ```
   curl http://localhost:3000/saude/completa     # "ok":true, com proxy, banco_leitura, banco_gravacao e sessoes
   ```
   Depois abra <http://localhost:5173> e entre com `chefe` / `Suprimax@2026`. Em desenvolvimento a página de
   aguardo não aparece: o sistema abre direto.
9. **Ao terminar:** `Ctrl+C` nos três terminais, `docker rm -f suprimax-local` no Ubuntu e apague a pasta
   `scripts/local_*` (tem os segredos locais).

Para recomeçar com dados limpos, rode o seed de novo (passo 6). Para testar o bloqueio por tentativas, a conta
trava com 3 senhas erradas por 15 minutos; para liberar, rode o seed de novo ou
`UPDATE operador SET tentativas_login_invalidas = 0, bloqueado_ate = NULL;` no banco local.

## Pendências conhecidas

- **E-mail em produção:** o backend envia pelo Resend quando `RESEND_API_KEY`, `EMAIL_REMETENTE` e
  `FRONTEND_URL` estão configuradas; em produção não estão. Sem isso, "Enviar" e a recuperação de senha não
  funcionam.
- **Plano gratuito do Render:** hibernação em 15 minutos, acordar leva até cerca de 1 minuto, e todo merge na
  `main` refaz o deploy dos dois serviços. Mantê-los acordados 24 h por dia gasta as 750 horas do mês em
  cerca de 15 dias.
- **Defeito conhecido, já corrigido no banco:** emitir uma nova versão de um orçamento (com origem) falhava
  em `proxy_orcamento_emitir` até a migration `20261124000000_emitir_nova_versao`. O seed ainda não usa o
  vínculo de origem.
- **Testes:** o backend é testado com um proxy falso (`backend/src/testing/`); as regras do banco têm testes
  contra Postgres real (`backend/database/tests`), mas falta um teste de integração automatizado entre
  backend, proxy e banco.
- **Pontos em aberto do contrato** (`docs/frontend-api.md`, `frontend/TAREFAS.md`): devolver pedido à lista,
  protesto de dívida e alcance da busca global.
