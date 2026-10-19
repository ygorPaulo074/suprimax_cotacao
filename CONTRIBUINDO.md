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
4. Copie `.env.example` (raiz) para `.env` no serviço e preencha. **Nunca** commite o `.env` nem chaves.

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
6. O CI (`ci`) precisa passar. O QA executa os testes e revisa, o gestor de projeto aprova e o responsável por infraestrutura faz o merge (*squash and merge*).

Quem abre o PR não pode aprovar o próprio PR: peça a revisão de outra pessoa do time.

## 3. Quem cuida de quê

| Área | Pasta | Orientações |
|---|---|---|
| Banco de dados | `backend/database/` | `backend/database/TAREFAS.md` |
| Proxy | `proxy/` | `proxy/TAREFAS.md` |
| Backend e módulo de cálculo | `backend/` | `backend/TAREFAS.md` |
| Frontend | `frontend/` | `frontend/TAREFAS.md` |
| QA | `*.test.ts`, `tests-nfr/` | Jest junto ao código; k6/Artillery em `tests-nfr/` |

Ordem de dependência: **banco → proxy → backend → integração com o frontend**. O backend nunca acessa o banco direto, só pelo proxy (RNF05).

## 4. Regras que valem para todos

- **Documentação primeiro:** em dúvida de regra, vale `docs/` (fonte: `docs/01…13`). Se a documentação estiver errada ou incompleta, abra uma issue ou PR ajustando o texto, em vez de contornar no código.
- **Dinheiro em centavos inteiros**; imposto de 18% arredondado uma vez por linha; limites inclusivos (R$ 500 e R$ 1.500).
- **Schema do banco:** qualquer mudança precisa da aprovação dos responsáveis pelos três sistemas antes do merge.
- **Contrato com o frontend:** `docs/frontend-api.md`. Mudou uma rota ou um tipo? Atualize esse documento e `frontend/src/api/` no mesmo PR (ou avise o responsável pelo frontend).
- **Testes:** funções do módulo de cálculo têm testes em tabela de casos (Jest). Código novo sem teste só passa com justificativa no PR.
- **Segredos:** `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_ADMIN_KEY`, `JWT_SIGNING_SECRET` e tokens ficam só em variáveis de ambiente (Render/Vercel), nunca no código.
