# Tarefas do frontend

Origem: o protótipo do Figma foi trazido para `frontend/` e reconstruído como aplicação real. A lista abaixo parte dos 7 pontos de adaptação levantados na análise do protótipo. `[x]` = feito; `[ ]` = pendente. Contrato com o backend: [frontend-api.md](../docs/frontend-api.md).

## 1. Ferramentas do projeto

- [x] npm + `package-lock.json` (o CI usa `npm ci`); pacote `suprimax-frontend`.
- [x] Vite + React 19 + Tailwind 4 (tokens de cor e Poppins em `src/index.css`), sem os plugins do Figma Make.
- [x] ESLint, Prettier, Jest e `typecheck` com os scripts que o CI chama.
- [x] Removidos `.figma/`, `.mise.toml`, `AGENTS.md`, o `CLAUDE.md` do protótipo e o `.docx` da Rev3.
- [x] O job `frontend` do CI passa no GitHub (confirmado no PR #1).
- [x] `frontend/.env` local criado com `VITE_API_URL=http://localhost:3000`.
- [ ] Publicar na Vercel (variável `VITE_API_URL`; o `vercel.json` já faz o fallback de SPA).
- [ ] Hospedar a fonte Poppins localmente (hoje vem do Google Fonts).

## 2. Dados reais no lugar do conteúdo fixo

- [x] Dados escritos no código (pedidos, clientes, itens, cartões) removidos de todas as telas.
- [x] Camada de API tipada (`src/api/`): cliente HTTP, `ApiError`, tipos e um módulo por recurso.
- [x] Estados de carregando (skeleton), erro com “Tentar novamente” e vazio com próxima ação (`DataState`).
- [ ] Backend implementar as rotas de [frontend-api.md](../docs/frontend-api.md) e validar o contrato.
- [ ] Teste ponta a ponta de cada fluxo (login → pedido → orçamento → emissão → resposta) com backend real.
- [ ] Alinhar com o backend a paginação das listas (hoje as rotas devolvem a lista completa).

## 3. Cálculos fora da tela

- [x] Valores em centavos inteiros; `formatarBRL` só formata (com testes).
- [x] Subtotal, imposto, frete, total, bloqueios e formas de pagamento permitidas vêm do backend.
- [ ] Backend completar o módulo de cálculo (hoje só `calcularImpostoItem`): faturamento, frete, estoque, número e validade, fechamento por item.
- [ ] Combinar os textos dos bloqueios (mínimo com “faltam R$ …”, crédito pendente, dívida, estoque insuficiente do UC19-E5).

## 4. Navegação e variações de tela

- [x] React Router com uma rota por tela e links diretos (filtros de clientes e orçamentos ficam na URL).
- [x] Removidos o “Wireframe Navigator” e os seletores de variação (`normal`, `min-value`, `no-stock`, `timeout`, …).
- [x] Variações viraram estados reais: mínimo, sem estoque, timeout com “Tentar novamente”, pendente de crédito, estoque insuficiente, dívida em aberto, divergência, LGPD, ajuste abaixo do reservado.
- [ ] Testes de tela para cada estado (Testing Library) quando houver backend/mocks de rede.
- [ ] Página 404 própria (hoje volta à rota inicial).

## 5. Perfis e menu

- [x] Menu e rotas por perfil conforme docs/10 seção 10.2 (`src/lib/perfis.ts`, com testes).
- [x] Vendedor e Gestor caem em “Seu perfil não utiliza o Sistema de Cotação”.
- [x] Faixas de preço e fardos só editáveis pelo operador chefe; ajuste de estoque só pelo chefe.
- [ ] Backend validar o perfil em cada rota (a tela só oculta).
- [ ] Contador de “Respostas pendentes” no menu depende de `GET /respostas-pendentes/contador`.

## 6. Itens da documentação que o protótipo não tinha

- [x] Login real com token, bloqueio após 3 tentativas e recuperação de senha.
- [x] Sessão encerrada automaticamente em `401`.
- [ ] **RNF06:** cache local das alterações em andamento, reenvio ao voltar a conexão e atualização da tela só após a leitura confirmada.
- [ ] Revisar os textos e campos de cada tela contra o capítulo 10 da documentação FINAL (o protótipo partiu de uma revisão anterior).
- [ ] Resolver os pontos em aberto de [frontend-api.md](../docs/frontend-api.md): “Devolver à lista”, protesto de dívida, efeito de “Enviar”, alcance da busca global.
- [ ] Pop-up de 7 dias para vencimento (RF16) é do vendedor, no Sistema 1; fora deste frontend.

## 7. Acabamento

- [x] Estilos inline migrados para Tailwind; componentes em `src/components/ui.tsx`.
- [x] Tela “Componentes e estados” disponível só em desenvolvimento (`/componentes`).
- [ ] Trocar os emojis por ícones SVG e usar o logo real (`docs/assets/marca/`).
- [ ] Verificação de acessibilidade: contraste 4,5:1, foco visível, navegação por teclado nos modais.
- [ ] Conferir telas em 1280 px (mínimo) e 1440 px (referência) no Chrome, Edge e Firefox (RNF08).
