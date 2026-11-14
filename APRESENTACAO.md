# Roteiro de apresentação

Apresentação com o sistema **na nuvem**: proxy e backend no Render, frontend na Vercel e banco no
Supabase. Escrito para o estado da `main` em `44bfacd`; atualize "O que já funciona" quando o
backend ganhar rotas.

> **Se a nuvem falhar na hora, vá direto para [Urgência: rodar local](#urgência-rodar-local).**

## Arquitetura da apresentação

```
Navegador ──► Frontend (Vercel) ──► Backend (Render) ──► Proxy (Render) ──► Supabase
```

| Serviço | Onde | Health check |
|---|---|---|
| Frontend | Vercel (`frontend/`), <https://suprimax-cotacao-tx8y.vercel.app> | abrir a URL |
| Backend (Sistema 2) | Render, serviço `suprimax-cotacao` | <https://suprimax-cotacao.onrender.com/saude> |
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
   node scripts/seed-demo.cjs --simular    # valida sem gravar
   node scripts/seed-demo.cjs --gravar     # grava de verdade
   ```
   Precisa de `npm ci` em `proxy/` e `backend/` na sua máquina. É seguro repetir: o que já existe
   não é duplicado nem alterado.

A nuvem só publica o que está na `main`. Código que não foi mesclado não aparece na apresentação.

### O que o seed cria

- **Usuários** (senha de todos: `Suprimax@2026`): `chefe` (operador chefe), `operador`, `vendedor1`,
  `vendedor2`, `fiscal`, `financeiro` e `gestor`.
- **5 clientes** (mercearia, restaurante, padaria, hotel matriz e filial), divididos entre os dois vendedores.
- **3 fornecedores.**
- **8 produtos** com marca, embalagem, 3 faixas de preço, fardo de 6 unidades e estoque.
  O `DEMO-CAFE-500` fica **sem estoque** de propósito, para mostrar o bloqueio.

Tudo é fictício. O prefixo `DEMO-` nos produtos identifica o que o seed criou.

## Na hora (checklist de 10 minutos antes)

1. **Acorde os dois serviços do Render, proxy primeiro.** No plano gratuito eles hibernam e o
   primeiro acesso leva de 30 a 60 segundos. Abra `/saude` do proxy e depois `/saude` do backend
   até responderem. Fazer nessa ordem importa: o backend espera só 10 segundos por tentativa ao
   falar com o proxy, então com o proxy dormindo o login falha.
2. **Entre com o `chefe` e deixe a sessão aberta.** As sessões do backend ficam **em memória**:
   qualquer deploy ou reinício desloga todo mundo. **Não mescle nada na `main` durante a
   apresentação**, porque isso dispara um deploy.
3. **Teste o login** com antecedência. O bloqueio é de **3 tentativas inválidas** (UC13). Se travar,
   limpe no SQL Editor do Supabase:
   `UPDATE operador SET tentativas_login_invalidas = 0, bloqueado_ate = NULL;`
4. **Não use a recuperação de senha:** o envio de e-mail não está ligado (veja "Pendências").

## O que já funciona

| Fluxo | Perfil para mostrar |
|---|---|
| Login, sessão e logout (UC13) | qualquer um |
| Clientes: busca por CNPJ, cadastro com aceite LGPD (UC02, UC03) | `operador` ou `chefe` |
| Produtos: lista, detalhe, cadastro e edição (UC04); faixas e fardos só o chefe | `chefe` (e `operador` para ver a restrição) |
| Fornecedores (UC22) | `chefe` |
| Usuários: listar, criar, mudar perfil e status (UC25) | `chefe` |

Sugestão de roteiro: login como `operador` → buscar um cliente pelo CNPJ (`11222333000181`) → tentar
editar faixa de preço (negado) → sair → entrar como `chefe` → editar o produto → criar um fornecedor
→ criar um usuário.

## O que NÃO mostrar

O backend ainda não tem as rotas de **pedidos, orçamentos, respostas pendentes, crédito, dívidas,
estoque e entradas de mercadoria**. O frontend tem as telas, mas elas chamarão rotas que respondem
404. Não abra essas telas ao vivo; mostre-as por wireframe (`docs/referencias/Wireframes_Sistema2.pdf`)
ou por prints.

O módulo de cálculo (`backend/services/calculo`) está implementado e testado, mas ainda não está
ligado a nenhuma rota. Mostre pelos testes: `cd backend && npx jest services/calculo`.

## Se algo falhar na nuvem

| Sintoma | Causa provável |
|---|---|
| Frontend demora ou mostra erro de rede no primeiro login | Render hibernado. Espere e tente de novo (veja o checklist). |
| Erro de CORS no console do navegador | `CORS_ORIGENS` do backend diferente da URL da Vercel (barra final, `http` em vez de `https`). |
| Frontend chama `localhost:3000` | `VITE_API_URL` não estava definida no build da Vercel: defina e faça novo deploy. |
| Backend no Render não sobe (log com "Configuração inválida") | Falta `PROXY_URL`, `PROXY_SERVICE_ID`, `PROXY_SERVICE_TOKEN` ou `CORS_ORIGENS`, ou alguma tem valor de exemplo/`localhost`. |
| `TOKEN_INVALIDO` nos logs | O `integrantes.sql` não foi rodado, ou os tokens do Render são de outra geração do `gerar-env`. |
| Proxy não sobe | `PROXY_ADMIN_KEY` ou `JWT_SIGNING_SECRET` curtos ou ausentes, ou `DATABASE_URL` vazia. |
| Todos deslogados do nada | O backend reiniciou ou fez deploy (sessões em memória). Entre de novo. |
| Login sempre falha | Seed não rodou, ou a conta foi bloqueada (3 tentativas). |

## Urgência: rodar local

Use se a nuvem não responder. O banco continua sendo o Supabase; sobem **três serviços**, nesta
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

## Pendências conhecidas (para o time do backend)

- Sessões em memória: perdem-se a cada deploy, reinício ou hibernação.
- E-mail: `NotificadorDeEmailMudo` só registra em log. O `RESEND_API_KEY` ainda não é lido.
- Rotas de pedidos, orçamentos e demais listadas acima.
- Os testes do backend usam um banco falso (`backend/src/testing/`), que não simula os gatilhos do
  banco real. Falta um teste de integração contra o proxy e o Supabase.
