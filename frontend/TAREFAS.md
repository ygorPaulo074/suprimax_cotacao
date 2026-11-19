# Tarefas do frontend

Origem: o protótipo do Figma foi trazido para `frontend/` e reconstruído como aplicação real. A lista abaixo parte dos 7 pontos de adaptação levantados na análise do protótipo. `[x]` = feito; `[ ]` = pendente. Contrato com o backend: [frontend-api.md](../docs/frontend-api.md).

## 1. Ferramentas do projeto

- [x] npm + `package-lock.json` (o CI usa `npm ci`); pacote `suprimax-frontend`.
- [x] Vite + React 19 + Tailwind 4 (tokens de cor e Poppins em `src/index.css`), sem os plugins do Figma Make.
- [x] ESLint, Prettier, Jest e `typecheck` com os scripts que o CI chama.
- [x] Removidos `.figma/`, `.mise.toml`, `AGENTS.md`, o `CLAUDE.md` do protótipo e o `.docx` da Rev3.
- [x] O job `frontend` do CI passa no GitHub (confirmado no PR #1).
- [x] `frontend/.env` local criado com `VITE_API_URL=http://localhost:3000`.
- [x] Publicar na Vercel (variável `VITE_API_URL`; o `vercel.json` já faz o fallback de SPA). Publicado na Vercel (conferido em 2026-11-16: o código publicado aponta para o backend do Render).
- [ ] Hospedar a fonte Poppins localmente (hoje vem do Google Fonts).

## 2. Dados reais no lugar do conteúdo fixo

- [x] Dados escritos no código (pedidos, clientes, itens, cartões) removidos de todas as telas.
- [x] Camada de API tipada (`src/api/`): cliente HTTP, `ApiError`, tipos e um módulo por recurso.
- [x] Estados de carregando (skeleton), erro com “Tentar novamente” e vazio com próxima ação (`DataState`).
- [x] Backend implementar as rotas de [frontend-api.md](../docs/frontend-api.md) e validar o contrato. Conferido em 2026-11-16: toda rota de `frontend-api.md` existe no backend.
- [x] "Devolver à lista" (UC10-A3) chama `POST /pedidos/:id/devolver`, com confirmação, carregando e erro; pedido com rascunho vinculado pergunta se retoma ou começa novo.
- [ ] Teste ponta a ponta de cada fluxo (login → pedido → orçamento → emissão → resposta) com backend real.
- [ ] Alinhar com o backend a paginação das listas (a lista de clientes já é paginada, `GET /clientes`; as demais devolvem a lista completa).
- [x] Clientes: lista paginada com busca e filtro de status, e endereço de entrega adicional na ficha (UC03, UC02-A1).

## 3. Cálculos fora da tela

- [x] Valores em centavos inteiros; `formatarBRL` só formata (com testes).
- [x] Subtotal, imposto, frete, total, bloqueios e formas de pagamento permitidas vêm do backend.
- [x] Backend completar o módulo de cálculo (hoje só `calcularImpostoItem`): faturamento, frete, estoque, número e validade, fechamento por item. Módulo de cálculo entregue (backend/CHANGELOG, 2026-11-04).
- [ ] Combinar os textos dos bloqueios (mínimo com “faltam R$ …”, crédito pendente, dívida, estoque insuficiente do UC19-E5).

## 4. Navegação e variações de tela

- [x] React Router com uma rota por tela e links diretos (filtros de clientes e orçamentos ficam na URL).
- [x] Removidos o “Wireframe Navigator” e os seletores de variação (`normal`, `min-value`, `no-stock`, `timeout`, …).
- [x] Variações viraram estados reais: mínimo, sem estoque, timeout com “Tentar novamente”, pendente de crédito, estoque insuficiente, dívida em aberto, divergência, LGPD, ajuste abaixo do reservado.
- [ ] Testes de tela para cada estado (Testing Library): feitos Login, Orçamentos (lista), Montagem do orçamento e Usuários, com a camada de API mockada; faltam as demais telas.
- [x] Botão "Novo orçamento" na ficha do cliente (UC14): `POST /orcamentos`, abre `/orcamentos/:id`, desabilitado com motivo se há dívida ou cliente inativo.
- [x] "Novo orçamento" também desabilitado para cliente BLOQUEADO (decisão do usuário; UC14).
- [x] Faixa de aviso de edição de rascunho na montagem do orçamento (UC14 a UC17): `lib/avisoDeRascunho.ts`. Depende do backend registrar quem edita itens e condições (hoje só status e follow-up).
- [x] Tela de Usuários: "Editar e-mail" por linha em modal (UC25).
- [x] Página 404 própria (hoje volta à rota inicial). `NaoEncontrada.tsx` (PR #24).

## 5. Perfis e menu

- [x] Menu e rotas por perfil conforme docs/10 seção 10.2 (`src/lib/perfis.ts`, com testes).
- [x] Vendedor e Gestor caem em “Seu perfil não utiliza o Sistema de Cotação”.
- [x] Faixas de preço e fardos só editáveis pelo operador chefe; ajuste de estoque só pelo chefe.
- [x] Backend validar o perfil em cada rota (a tela só oculta). `exigirPerfil` por rota, com testes de 403 (PR #30).
- [ ] Contador de “Respostas pendentes” no menu depende de `GET /respostas-pendentes/contador`.

## 6. Itens da documentação que o protótipo não tinha

- [x] Login real com token, bloqueio após 3 tentativas e recuperação de senha.
- [x] Sessão encerrada automaticamente em `401`.
- [x] Leitura que nunca responde: prazo de 60 s nos GET (erro "Sem conexão com o servidor. Tente novamente.") e aviso "O servidor está demorando para responder…" após 15 s (RNF06). Gravações e fila não têm prazo.
- [ ] Ajustar o prazo de 60 s se o plano do Render deixar de hibernar, ou se o acordar do backend passar disso na prática (medir no teste manual).
- [x] Redefinir senha (UC13): tela `/redefinir-senha` (PR #24). O e-mail com o link ainda não é enviado (sem provedor); use `scripts/definir-senha.cjs`.
- [x] Quitar dívida (UC23), abrir anexo por URL assinada e erros de upload (UC19) (PR #24).
- [x] Upload do documento de crédito (PDF/JPEG/PNG, até 10 MB) e botão Abrir por URL assinada na análise de crédito (UC07).
- [x] Perfil `ADMIN` (acesso total; só ADMIN gerencia ADMIN) (PR #31).
- [x] **RNF06:** fila persistida de alterações de orçamento sem conexão, `Idempotency-Key`, reenvio em ordem ao voltar a rede e saída da fila só após a releitura (`api/filaOffline.ts`).
- [ ] RNF06 fora do escopo atual: cadastros (clientes, produtos etc.), criação de orçamento (`POST /orcamentos`, precisa do id na resposta) e upload de anexo ficam sem fila; falta teste manual no navegador com rede cortada.
- [x] **RNF06 (média):** leituras do TanStack Query com `networkMode: 'always'` (`lib/queryClient.ts`): com o evento `offline` a consulta falha e a tela mostra "Sem conexão com o servidor. Tente novamente." em vez de esqueleto cinza para sempre (achado do teste de queda de conexão, TNF 9).
- [x] **RNF06 (baixa):** a tela de erro do detalhe do orçamento ganha título e o link "Voltar para orçamentos" (`screens/Orcamento.tsx`).
- [x] **RNF06 (baixa):** aviso de alterações não salvas ao sair da montagem do orçamento (`lib/useAvisoNaoSalvo.ts`: `useBlocker` + `beforeunload`) quando o cabeçalho (contato, solicitação, endereço, prazo) foi editado e não salvo. O app passou a usar roteador de dados (`createBrowserRouter`). Fora do aviso: campos de condições comerciais, busca de produtos e quantidades de itens, e outras telas com formulário (cadastros, usuários); o aviso também aparece para uma alteração já guardada na fila offline (ainda não enviada).
- [x] **RNF06 (baixa):** aviso de alterações não salvas estendido (`useAvisoNaoSalvo` agora devolve `{ bloqueio, liberar }`; modal em `components/AvisoNaoSalvoModal.tsx`): (1) condições comerciais da montagem (pagamento, prazo, parcelas, origem, transportadora, frete) entram na detecção; a comparação usa formas canônicas (`lib/montagemComparavel.ts`: frete em centavos inteiros, vazio = null, número = texto, campos que não valem para a condição escolhida ignorados); (2) formulários de cadastro de cliente, endereço novo na ficha do cliente, fornecedor, produto e novo usuário; salvar com sucesso e Cancelar descartam sem aviso; (3) alteração já guardada na fila offline (resposta `ENFILEIRADA`, item em `suprimax.fila`) não avisa enquanto estiver na fila e sem falha (`lib/useAlteracaoNaFila.ts`); o aviso volta se algum item da fila esgotou as tentativas (a fila para) ou se o item foi descartado por 4xx, ou se há texto novo depois do que foi guardado.
- [x] **RNF06 (baixa):** corrigidos dois achados do QA do #74: (1) a montagem reidrata o bloco (cabeçalho/condições) quando o orçamento lido muda por fora e o usuário não o editou (fim do falso aviso após a fila sincronizar); (2) `useAvisoNaoSalvo` compara `pathname + search`, cobrindo `/clientes?cnpj=…` → `/clientes` com o formulário de endereço sujo. Aberto: a tela reaberta com a fila offline ainda mostra o valor do servidor, não o guardado na fila (só o chip indica a pendência).
- [ ] Aviso de não salvo ainda fora de: modal "Editar e-mail" de Usuários, busca de produtos e quantidades de itens da montagem, Análise de crédito/Entrada de mercadoria/Ajuste de estoque (formulários não revisados), e condições enviadas pelo caminho de "Emitir orçamento" quando a gravação vai para a fila (o aviso permanece, por segurança).
- [ ] Revisar os textos e campos de cada tela contra o capítulo 10 da documentação FINAL (o protótipo partiu de uma revisão anterior).
- [ ] Resolver os pontos em aberto de [frontend-api.md](../docs/frontend-api.md): “Devolver à lista”, protesto de dívida, efeito de “Enviar”, alcance da busca global.
- [ ] Pop-up de 7 dias para vencimento (RF16) é do vendedor, no Sistema 1; fora deste frontend.

## 7. Acabamento

- [x] Estilos inline migrados para Tailwind; componentes em `src/components/ui.tsx`.
- [x] Tela “Componentes e estados” disponível só em desenvolvimento (`/componentes`).
- [ ] Trocar os emojis por ícones SVG e usar o logo real (`docs/assets/marca/`).
- [ ] Verificação de acessibilidade: contraste 4,5:1, foco visível, navegação por teclado nos modais.
- [ ] Conferir telas em 1280 px (mínimo) e 1440 px (referência) no Chrome, Edge e Firefox (RNF08).
