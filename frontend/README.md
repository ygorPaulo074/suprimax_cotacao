# Frontend — Sistema de Cotação Web (Sistema 2)

React 19 + Vite + Tailwind CSS 4 + TypeScript. Consome **somente** a API REST do backend do Sistema 2 (nunca o proxy nem o banco). Telas e regras: [docs/10-frontend.md](../docs/10-frontend.md).

## Comandos

```bash
npm install
cp ../.env.example .env   # ajuste VITE_API_URL (padrão: http://localhost:3000)
npm run dev               # http://localhost:5173
npm run lint && npm run format:check && npm run typecheck && npm test
npm run build
```

## Estrutura

```
src/
  api/          camada de API: client.ts (fetch, token, ApiError), types.ts (contrato) e um módulo por recurso
  auth/         AuthContext (sessão, token) e RotaProtegida (por perfil)
  components/   ui.tsx (botões, campos, tabela, modal, badges…), DataState, orcamento.tsx
  layout/       AppShell (barra superior + menu por perfil)
  lib/          dinheiro (centavos ⇄ R$), datas, perfis (menu), opcoes
  screens/      uma tela por arquivo (as 18 telas do capítulo 10) + Orcamento (escolhe montagem ou detalhe)
```

## Regras que o código segue

- Dinheiro sempre em **centavos inteiros**; a tela só formata. Imposto, frete, totais e limites vêm do backend (módulo de cálculo).
- Sem dados de exemplo nas telas: tudo vem da API, com skeleton, erro e tela vazia.
- Menu e rotas por perfil são só conveniência; quem autoriza é o backend.
- Paleta e fonte: tokens em `src/index.css`. Sem vermelho; erros e bloqueios em laranja, com ícone e texto.
- Contrato com o backend: [docs/frontend-api.md](../docs/frontend-api.md). Pendências: [docs/tarefas-frontend.md](../docs/tarefas-frontend.md).
