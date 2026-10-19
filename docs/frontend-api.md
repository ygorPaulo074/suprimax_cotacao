# Contrato frontend ↔ backend (Sistema 2)

O frontend só conversa com o backend do Sistema 2 por REST/JSON (docs/10, seção 10.1; docs/11, seção 11.2). Este documento descreve o que o frontend **já espera**; o backend deve implementar estas rotas (ou combinar ajustes e atualizar a camada em `frontend/src/api/`).

Fonte do contrato (código): `frontend/src/api/types.ts` (tipos) e um arquivo por recurso em `frontend/src/api/`.

## Convenções

- **Base:** `VITE_API_URL` (sem barra final). Todas as rotas abaixo são relativas a ela.
- **Autenticação:** `Authorization: Bearer <token>` em toda rota, exceto `POST /auth/login` e `POST /auth/recuperar-senha`. Um `401` encerra a sessão no frontend.
- **Dinheiro:** inteiro em **centavos** (`Centavos`). O frontend só formata (`R$ 0.000,00`); nunca calcula imposto, frete, totais ou limites. O backend converte de/para `DECIMAL(12,2)`.
- **Datas:** `AAAA-MM-DD` (datas) ou ISO 8601 (data e hora).
- **Nomes:** camelCase, derivados do dicionário de dados (`preco_unitario_aplicado` → `precoUnitarioAplicado`).
- **Orçamento:** toda mutação devolve o `OrcamentoDetalhe` **já recalculado** pelo módulo de cálculo (docs/11, seção 11.6). Os bloqueios de emissão vêm em `condicoes.bloqueios[]` com a mensagem pronta (ex.: “Abaixo do faturamento mínimo de R$ 500,00 – faltam R$ 107,65”), e as formas de pagamento permitidas em `condicoes.condicoesPagamentoPermitidas`.
- **Erros:** status HTTP adequado e corpo `{ "codigo": "…", "mensagem": "…", "detalhes": { … } }`. A `mensagem` é exibida ao operador, então deve estar em português e não expor detalhes internos.
- **Autorização:** o menu por perfil é só conveniência; cada rota deve validar o perfil (docs/10, seção 10.2).

## Rotas

| Tela / UC | Método e rota | Corpo / retorno | Perfis |
|---|---|---|---|
| 1 · UC13 Login | `POST /auth/login` | `{usuario, senha}` → `{token, usuario: Sessao}`; `401 CREDENCIAIS_INVALIDAS`; `423 CONTA_BLOQUEADA` (`detalhes.bloqueadoAte`, após 3 tentativas) | todos |
| | `GET /auth/me` · `POST /auth/logout` | `Sessao` · 204 | todos |
| | `POST /auth/recuperar-senha` | `{email}` → 204 (sempre) | — |
| 2 · UC10 Pedidos | `GET /pedidos?status=` | `{itens: PedidoResumo[], indicadores}` | Operador, Chefe |
| | `POST /pedidos/:id/assumir` | `pedido.assumir` → `PedidoDetalhe`; `409 PEDIDO_JA_ASSUMIDO` | Operador, Chefe |
| 3 · UC10 Análise | `GET /pedidos/:id` | `PedidoDetalhe` (itens com saldo, situação do cliente) | Operador, Chefe |
| | `POST /pedidos/:id/montar-orcamento` | cria o RASCUNHO → `{idOrcamento}` | Operador, Chefe |
| | `POST /pedidos/:id/negar` | `{motivo}` obrigatório → 204 | Operador, Chefe |
| 4 · UC03 Clientes | `GET /clientes/busca?cnpj=` | `ClienteFicha`; `404 CLIENTE_NAO_ENCONTRADO` | Operador, Chefe |
| | `GET /clientes/:id/orcamentos-em-aberto` · `/historico-compras` | `OrcamentoResumo[]` · `HistoricoCompra[]` | Operador, Chefe |
| 5 · UC02 Cadastro | `POST /clientes` | `ClienteNovo` (`aceiteLgpd: true` obrigatório) → `ClienteFicha` | Operador, Chefe |
| | `GET /vendedores` | `VendedorOpcao[]` | Operador, Chefe |
| 6 · UC01/14–19 Montagem | `GET /orcamentos/:id` | `OrcamentoDetalhe` | Operador, Chefe |
| | `PATCH /orcamentos/:id` | cabeçalho (contato, nº solicitação, endereço, prazo de entrega) | idem |
| | `POST /orcamentos/:id/itens` | `ItemAdicionar`; `422 ESTOQUE_INDISPONIVEL`; `503 ESTOQUE_TIMEOUT` | idem |
| | `PATCH` / `DELETE /orcamentos/:id/itens/:idItem` | `{quantidade}` / — | idem |
| | `PUT /orcamentos/:id/condicoes` | `CondicoesAtualizar` | idem |
| | `POST /orcamentos/:id/anexos` (multipart) · `DELETE …/anexos/:idAnexo` | `tipoAnexo`, `arquivo` | idem |
| | `POST /orcamentos/:id/emitir` | `orcamento.emitir`; `422` com bloqueio (ex.: `ESTOQUE_INSUFICIENTE`) | idem |
| | `GET /produtos/busca?q&marca&tamanhoEmbalagem&categoria&idCliente` | `Produto[]` com preço da tabela do cliente | idem |
| 7 · UC03 Lista | `GET /orcamentos?status&cliente&cnpj&numero&de&ate` | `OrcamentoResumo[]` | Operador, Chefe |
| 8 · UC08/19 Detalhe | `GET /orcamentos/:id/pdf` | arquivo PDF | Operador, Chefe |
| | `POST /orcamentos/:id/enviar` · `POST /orcamentos/:id/cancelar` | 204 · `{justificativa?}` → 204 | Operador, Chefe |
| 9 · UC21 Respostas | `GET /respostas-pendentes?tipo&idVendedor` · `GET /respostas-pendentes/contador` | `RespostaPendenteResumo[]` · `{total}` | Operador, Chefe |
| 10 · UC21 Tratar | `GET /respostas-pendentes/:id` | `RespostaPendenteDetalhe` (cria/retoma o rascunho da nova versão) | Operador, Chefe |
| | `POST /respostas-pendentes/:id/emitir-nova-versao` | → `{idOrcamento}`; original vira SUBSTITUIDO | Operador, Chefe |
| | `POST …/tratar-sem-nova-versao` · `DELETE …/rascunho` | 204 | Operador, Chefe |
| 11 · UC07 Crédito | `GET /analises-credito` · `GET /analises-credito/:id` | `AnaliseCreditoResumo[]` · `AnaliseCreditoDetalhe` | Fiscal |
| | `POST …/documentos` · `POST …/resultado` | `{tipoDocumento, dataRecebimento}` · `{resultado}` | Fiscal |
| 12 · UC23 Dívidas | `GET /dividas` · `POST /dividas` | `Divida[]` · `DividaNova` | Financeiro |
| | `POST /dividas/:id/renegociar` | `{dataRenegociacao, valorPago}`; `422` se < 50% | Financeiro |
| 13 · UC04 Produtos | `GET /produtos?q` · `GET /produtos/:id` | `Produto[]` · `Produto` | Operador, Chefe |
| | `POST /produtos` · `PUT /produtos/:id` | `ProdutoSalvar`; faixas e fardos só do Chefe (`403`) | Operador, Chefe |
| 14 · UC24 Estoque | `GET /estoque/variacoes?q` · `GET /estoque/variacoes/:id` | `SaldoEstoque[]` · `SaldoEstoque` | Chefe |
| | `GET …/:id/movimentacoes` · `POST …/:id/ajustes` | `MovimentacaoEstoque[]` · `{quantidade, motivo}`; `422 AJUSTE_ABAIXO_DO_RESERVADO` | Chefe |
| 15 · UC04 Entrada | `POST /entradas-mercadoria` | `EntradaMercadoriaNova`; `422 ENTRADA_DIVERGENTE`; `403 LIBERACAO_NEGADA` | Operador, Chefe |
| 16 · UC22 Fornecedores | `GET /fornecedores` · `POST /fornecedores` | `Fornecedor[]` · `FornecedorNovo` | Chefe (`GET` também Operador) |
| 17 · UC25 Usuários | `GET /usuarios` · `POST /usuarios` | `Usuario[]` · `UsuarioNovo` | Chefe |
| | `PATCH /usuarios/:id` | `{perfil?, status?, idNovoVendedor?}`; `422 NOVO_VENDEDOR_OBRIGATORIO` | Chefe |

## Pontos a confirmar com o time de backend

- **Nomes das rotas:** a documentação não define as rotas REST do Sistema 2 (só as operações do proxy). Se o backend preferir outro desenho, basta ajustar os arquivos de `frontend/src/api/`.
- **“Devolver à lista” (tela 3):** a documentação não prevê a transição EM_ANALISE → SOLICITADO. Hoje o botão só volta à lista, e o pedido continua EM_ANALISE com o operador.
- **Protesto de dívida (tela 12):** a tabela tem `data_protesto` e o status PROTESTADA, mas o UC23 só descreve registrar dívida e renegociação. Não há ação de protestar na tela.
- **Enviar orçamento (tela 8):** o frontend chama `POST /orcamentos/:id/enviar`; o efeito (e-mail, marcação para o vendedor) precisa ser definido no UC08.
- **Busca global:** hoje leva a `/orcamentos?cliente=<termo>`. Definir se deve buscar também por CNPJ, número e pedido.
- **Token de sessão:** guardado em `sessionStorage` (por aba). Se o backend preferir cookie HttpOnly, mudar `AuthContext` e `client.ts`.
