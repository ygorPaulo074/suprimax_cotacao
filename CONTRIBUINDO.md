# Como contribuir

Guia para quem vai desenvolver neste repositório. As regras vêm da documentação (`docs/03-requisitos-nao-funcionais.md`, seção 3.3).

## 1. Acesso

1. Aceite o convite do repositório (chega por e-mail e em github.com/notifications).
2. Configure sua identidade, que aparece no histórico:
   ```bash
   git config --global user.name "Seu Nome"
   git config --global user.email "o-mesmo-email-da-sua-conta-do-github"
   ```
3. Clone e instale o serviço em que você trabalha:
   ```bash
   git clone https://github.com/ygorPaulo074/suprimax_cotacao.git
   cd suprimax_cotacao/<servico>   # frontend, backend ou proxy
   npm install
   ```
4. Em cada serviço (`proxy/`, `backend/`, `frontend/`), copie o `.env.example` da própria pasta para `.env` e preencha (ou use `node scripts/gerar-env.cjs`). **Nunca** commite o `.env` nem chaves.

## 2. Fluxo de trabalho

A `main` é protegida: **não há push direto**, tudo entra por Pull Request.

1. Atualize a main e crie uma branch por tarefa, no padrão `feature/<serviço>/<tarefa>`:
   ```bash
   git checkout main && git pull
   git checkout -b feature/backend/uc13-login
   ```
2. Faça commits pequenos, um por passo lógico, com mensagem clara (ex.: `feat(backend): login com bloqueio apos 3 tentativas`).
3. Antes de enviar, rode no serviço: `npm run lint`, `npm run format:check`, `npm run typecheck` e `npm test`.
4. `git push -u origin feature/backend/uc13-login` e abra o Pull Request para a `main`.
5. **Todo PR cita o caso de uso (UC) ou requisito (RF/RNF) que implementa** e inclui a entrada no `CHANGELOG.md` do serviço (data, descrição e UC).
6. O CI (`ci`) precisa passar (ver "O que o CI verifica" abaixo). O QA executa os testes e revisa, o gestor de projeto aprova e o responsável por infraestrutura faz o merge (_squash and merge_).

Quem abre o PR não pode aprovar o próprio PR: peça a revisão de outra pessoa do time.

### O que o CI verifica

O check obrigatório da `main` é só o `ci`, que agrega os demais jobs de `.github/workflows/ci.yml`:

- **frontend, backend e proxy:** lint, Prettier nos arquivos alterados, typecheck e Jest. No frontend o Jest roda também os `*.test.tsx` (jsdom). O cache do npm é por serviço.
- **database:** valida o schema Prisma, aplica as migrations em um PostgreSQL 16 e roda os testes de regra.
- **changelog (só em PR):** se o PR altera código de `frontend/`, `backend/`, `proxy/`, `scripts/` ou `tests-nfr/`, o `CHANGELOG.md` desse serviço precisa estar no PR. Arquivos `.md` do serviço (README, TAREFAS) não contam como código, então PR só de documentação passa. Para testar localmente: `bash .github/scripts/checar-changelog.sh origin/main HEAD`.
- **scripts e tests-nfr:** checagem de sintaxe (`node --check`) dos `.cjs`/`.mjs` e o teste puro `tests-nfr/lib.urlEhLocal.test.mjs`. Não há lint nem Prettier nessas pastas ainda, porque os arquivos atuais não estão formatados.

Uma nova execução no mesmo PR cancela a anterior, e cada job tem tempo máximo (5 a 15 minutos).

## 3. Quem cuida de quê

| Área                        | Pasta                     | Orientações                                        |
| --------------------------- | ------------------------- | -------------------------------------------------- |
| Banco de dados              | `backend/database/`       | `backend/database/TAREFAS.md`                      |
| Proxy                       | `proxy/`                  | `proxy/TAREFAS.md`                                 |
| Backend e módulo de cálculo | `backend/`                | `backend/TAREFAS.md`                               |
| Frontend                    | `frontend/`               | `frontend/TAREFAS.md`                              |
| QA                          | `*.test.ts`, `tests-nfr/` | Jest junto ao código; k6/Artillery em `tests-nfr/` |

Ordem de dependência: **banco → proxy → backend → integração com o frontend**. O backend nunca acessa o banco direto, só pelo proxy (RNF05).

## 4. Regras que valem para todos

- **Documentação primeiro:** em dúvida de regra, vale `docs/` (fonte: `docs/01…13`). Se a documentação estiver errada ou incompleta, abra uma issue ou PR ajustando o texto, em vez de contornar no código.
- **Dinheiro em centavos inteiros**; imposto de 18% arredondado uma vez por linha; limites inclusivos (R$ 500 e R$ 1.500).
- **Schema do banco:** qualquer mudança precisa da aprovação dos responsáveis pelos três sistemas antes do merge.
- **Contrato com o frontend:** `docs/frontend-api.md`. Mudou uma rota ou um tipo? Atualize esse documento e `frontend/src/api/` no mesmo PR (ou avise o responsável pelo frontend).
- **Testes:** funções do módulo de cálculo têm testes em tabela de casos (Jest). Código novo sem teste só passa com justificativa no PR.
- **Segredos:** `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_ADMIN_KEY`, `JWT_SIGNING_SECRET` e tokens ficam só em variáveis de ambiente (Render/Vercel), nunca no código.
- **Fim de linha:** os arquivos do repositório usam LF (o Prettier exige). O `.gitattributes` (`* text=auto eol=lf`) faz o Git gravar e extrair LF mesmo no Windows com `core.autocrlf=true`; o repositório já está todo em LF, então ele não reescreve nada. Se o `format:check` reclamar de CRLF num arquivo seu, rode `npm run format` no serviço (ou `git add --renormalize <arquivo>`). Não renormalize o repositório inteiro.
