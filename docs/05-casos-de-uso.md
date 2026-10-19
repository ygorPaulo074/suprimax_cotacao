# 5. Casos de Uso


A tabela a seguir relaciona todos os casos de uso do Sistema de Cotação (Sistema 2). Os casos UC01 a UC12 cobrem o processo de negócio conforme descrito nas seções 2 a 4; os casos UC13 a UC19 (seção 5.14) detalham tecnicamente os passos internos do fluxo de geração de cotação (UC01), no nível de tela e de validação de sistema. Os casos UC20 a UC25 (seções 5.22 a 5.27) cobrem o processamento da resposta do cliente, o tratamento pelo operador e a nova versão do orçamento, o cadastro de fornecedores, o registro de dívidas, o ajuste de estoque e a gestão de usuários.


| **Caso de uso** | **Ator(es)** | **Detalhado na** |
|---|---|---|
| **UC01 — Gerar cotação** | Operador | 5.2 |
| **UC02 — Cadastrar cliente** | Operador | 5.3 |
| **UC03 — Consultar histórico** | Operador | 5.4 |
| **UC04 — Cadastrar produto** | Operador / Operador chefe | 5.5 |
| **UC05 — Editar orçamento em rascunho** | Operador | 5.6 |
| **UC06 — Cancelar orçamento** | Operador | 5.7 |
| **UC07 — Realizar análise de crédito** | Operador / Fiscal / Cliente | 5.8 |
| **UC08 — Exportar/enviar orçamento** | Operador | 5.9 |
| **UC09 — Consultar painel de BI/Dashboard** | Gestor / Sistema 3 | 5.10 |
| **UC10 — Registrar e analisar pedido do Sistema 1** | Vendedor (Sistema 1) / Operador (Sistema 2) | 5.11 |
| **UC11 — Responder orçamento enviado** | Cliente, via vendedor no Sistema 1 | 5.12 |
| **UC12 — Atualizar status de orçamento pendente** | Vendedor | 5.13 |
| **UC13 — Autenticar usuário** | Todos os perfis | 5.15 |
| **UC14 — Iniciar cotação / selecionar cliente** | Operador | 5.16 |
| **UC15 — Buscar e filtrar produtos** | Operador | 5.17 |
| **UC16 — Adicionar item ao orçamento** | Operador | 5.18 |
| **UC17 — Validar estoque** | Sistema (acionado pelo UC16) | 5.19 |
| **UC18 — Calcular condições comerciais** | Sistema (acionado pelo UC19) | 5.20 |
| **UC19 — Gerar orçamento seguro** | Operador | 5.21 |
| **UC20 — Processar resposta do cliente** | Sistema (Sistema 2) | 5.22 |
| **UC21 — Tratar resposta pendente e criar nova versão do orçamento** | Operador | 5.23 |
| **UC22 — Cadastrar fornecedor** | Operador chefe | 5.24 |
| **UC23 — Registrar dívida e renegociação** | Financeiro | 5.25 |
| **UC24 — Ajustar estoque** | Operador chefe | 5.26 |
| **UC25 — Gerenciar usuários** | Operador chefe | 5.27 |


## 5.2 UC01 — Gerar cotação


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Operador autenticado no sistema (RF01, RF08); cliente já cadastrado na base compartilhada (UC02). O orçamento pode ser iniciado a partir de um pedido registrado pelo Sistema 1 (UC10). |
| **Fluxo Principal** | 1. Operador realiza login individual (RF01, RF08). <br> 2. Operador seleciona o pedido registrado pelo Sistema 1 (UC10) ou busca o cliente por CNPJ (RF04). <br> 3. Sistema retorna dados cadastrais, orçamentos em aberto e histórico de compras do cliente (RF04). <br> 4. Operador seleciona produtos, marcas e quantidades (ou confere os itens do pedido), respeitando a disponibilidade de estoque à pronta entrega (RF18). <br> 5. Sistema aplica automaticamente as regras de faturamento mínimo, análise de crédito, parcelamento, frete e imposto de 18% (RF06, seção 4). <br> 6. Operador emite o orçamento; o sistema atribui a numeração sequencial (RF12, regra 4.4), cria as reservas de estoque e registra o orçamento como ABERTO (UC19). |
| **Fluxos Alternativos** | A1 – Cliente em primeira compra: pagamento é definido como 100% adiantado, independentemente do valor (regra 4.1). <br> A2 – Cotação vinculada a um número de solicitação de compra e a um contato específico do cliente (RF10). <br> A3 – Operador anexa arquivos de apoio à cotação, como descritivos técnicos e materiais de marketing (RF11). <br> A4 – Orçamento iniciado a partir de pedido do Sistema 1: após aprovar o pedido (UC10), os produtos e a configuração do pedido pré-preenchem o orçamento, que fica vinculado ao pedido. |
| **Fluxos de Exceção** | E1 – Variação específica do produto sem estoque disponível: inclusão bloqueada, mesmo que outra variação do mesmo produto esteja disponível (RF18, regra 4.4). <br> E2 – Faturamento mínimo de R$ 500 não atingido a partir da segunda compra: orçamento não pode ser fechado por faturamento a prazo (regra 4.1). |
| **Pós-condições** | Orçamento numerado e persistido, com regras comerciais aplicadas e reservas de estoque criadas, pronto para exportação (UC08). |
| **Regras de Negócio** | RF04, RF06, RF10, RF11, RF12, RF13, RF18, RF23; regras 4.1, 4.2, 4.3 e 4.4. Detalhamento técnico deste fluxo em UC13–UC19 (seção 5.14). |


## 5.3 UC02 — Cadastrar cliente


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Operador autenticado; cliente ainda não cadastrado na base. |
| **Fluxo Principal** | 1. Operador acessa a tela de cadastro de cliente. <br> 2. Preenche dados cadastrais, contato, endereço, indicação de matriz/filial e locais de entrega (RF03). <br> 3. Sistema exibe a cláusula de consentimento LGPD no formulário de cadastro (RF20). <br> 4. Operador confirma o consentimento e salva o cadastro. |
| **Fluxos Alternativos** | A1 – Cliente com múltiplos locais de entrega: operador cadastra cada endereço adicional vinculado à mesma matriz/filial (RF03). |
| **Fluxos de Exceção** | E1 – Cadastro salvo sem a cláusula de consentimento LGPD confirmada: sistema bloqueia o salvamento até a confirmação (RF20). |
| **Pós-condições** | Cliente cadastrado e disponível para busca por CNPJ em toda a solução (RF04), incluindo Sistema 1 e Sistema 3, por se tratar de base única e compartilhada (seção 1.4). |
| **Regras de Negócio** | RF03, RF20. |


## 5.4 UC03 — Consultar histórico


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Operador autenticado; cliente cadastrado na base. |
| **Fluxo Principal** | 1. Operador busca o cliente por CNPJ (RF04). <br> 2. Sistema retorna dados cadastrais, orçamentos em aberto e histórico de compras (RF04, RF07). |
| **Fluxos Alternativos** | A1 – Histórico consultado a partir de uma cotação em edição (UC05), sem necessidade de nova busca por CNPJ. |
| **Fluxos de Exceção** | E1 – CNPJ não localizado na base: sistema informa a ausência de cadastro e sugere o UC02. |
| **Pós-condições** | Histórico de cotações e compras do cliente exibido ao operador. |
| **Regras de Negócio** | RF04, RF07. |


## 5.5 UC04 — Cadastrar produto


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador / Operador chefe (perfil de exceção) |
| **Pré-condições** | Operador autenticado no sistema. |
| **Fluxo Principal** | 1. Operador acessa a tela de cadastro de produto. <br> 2. Cadastra o produto com múltiplas marcas e tamanhos/embalagens (RF02). <br> 3. Informa código interno, classificação fiscal (NCM), quando aplicável ao produto (RF09), EAN e categoria. <br> 4. Cadastra, por variação, as faixas de preço da venda avulsa e os fardos com preço fixo; somente o operador chefe altera preços. <br> 5. Sistema salva o cadastro do produto. <br> 6. Na entrada de mercadoria, o operador seleciona o fornecedor cadastrado (UC22) e informa a quantidade recebida do fornecedor. <br> 7. Sistema valida se a quantidade informada corresponde exatamente à quantidade comprada na cotação de compra (RF19). <br> 8. Confirmada a entrada, o sistema registra a movimentação ENTRADA e soma a quantidade ao estoque físico da variação. |
| **Fluxos Alternativos** | A1 – Produto com múltiplas variações de tamanho/embalagem: cada variação é tratada como um item de estoque independente para fins de disponibilidade (regra 4.4). |
| **Fluxos de Exceção** | E1 – Divergência entre a quantidade informada e a quantidade comprada: sistema bloqueia o salvamento e exige login e senha de um operador chefe para liberar a exceção (RF19). |
| **Pós-condições** | Produto cadastrado (ou entrada de mercadoria confirmada) e disponível para inclusão em orçamentos (UC01), respeitando a disponibilidade de estoque (RF18). |
| **Regras de Negócio** | RF02, RF09, RF19, RF26. |


## 5.6 UC05 — Editar orçamento em rascunho


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Orçamento existente com status RASCUNHO ou PENDENTE_CREDITO. Orçamentos emitidos (ABERTO) são imutáveis e não podem ser editados (RN22). |
| **Fluxo Principal** | 1. Operador busca o orçamento em rascunho (UC03). <br> 2. Altera produtos e quantidades do orçamento. <br> 3. Sistema reaplica as regras comerciais de faturamento, crédito, parcelamento, frete e imposto (RF06, seção 4). <br> 4. Operador salva o orçamento atualizado. |
| **Fluxos Alternativos** | A1 – Alteração dispara novamente a verificação de disponibilidade de estoque à pronta entrega (RF18), podendo remover itens que ficaram indisponíveis. <br> A2 – Pedido de alteração do cliente sobre orçamento já emitido: o original não é editado; cria-se uma nova versão (UC21). |
| **Fluxos de Exceção** | E1 – Orçamento já emitido, aceito, recusado, cancelado, substituído ou expirado: edição bloqueada; para alterar um orçamento emitido, cria-se uma nova versão (UC21). <br> E2 – Rascunho expirado (30 dias sem edição): edição bloqueada; é necessário iniciar um novo orçamento (UC01). |
| **Pós-condições** | Rascunho atualizado, com regras comerciais reaplicadas e histórico preservado (RF07). |
| **Regras de Negócio** | RF06, RF07, RF18, RF21, RF23; seção 4. |


## 5.7 UC06 — Cancelar orçamento


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Orçamento existente, em rascunho, pendente de crédito ou emitido (ABERTO). |
| **Fluxo Principal** | 1. Operador busca o orçamento (UC03). <br> 2. Seleciona a opção de cancelar. <br> 3. Sistema solicita a justificativa do motivo do cancelamento, que é opcional. <br> 4. Operador confirma o cancelamento; se o orçamento estava emitido, as reservas de estoque são liberadas. |
| **Fluxos Alternativos** | Não se aplica. |
| **Fluxos de Exceção** | Não se aplica: a justificativa é opcional e o sistema aceita o campo vazio (RF14). |
| **Pós-condições** | Orçamento cancelado, com justificativa registrada quando informada, mantido no histórico do cliente (RF07). |
| **Regras de Negócio** | RF07, RF14. |


## 5.8 UC07 — Realizar análise de crédito


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador / Equipe fiscal / Cliente |
| **Pré-condições** | Cliente solicita compra a prazo ou parcelada, com valor igual ou superior a R$ 500, a partir da segunda compra (regra 4.1). |
| **Fluxo Principal** | 1. Cliente envia a documentação exigida: contrato social, balanço de lucro, comprovante de endereço, documento do proprietário, notas fiscais das últimas cinco compras e referências comerciais (seção 4.1.1). <br> 2. Equipe fiscal analisa a documentação recebida. <br> 3. Cliente é avisado do resultado da análise. <br> 4. Equipe fiscal registra o resultado (APROVADO ou REPROVADO) na análise de crédito, e o orçamento deixa o status PENDENTE_CREDITO. |
| **Fluxos Alternativos** | A1 – Crédito aprovado: negociação segue com boleto (prazos de 10, 15, 20, 28 ou 30 dias corridos) ou parcelamento — disponível a partir de R$ 1.500 —, conforme as regras vigentes (regra 4.1). |
| **Fluxos de Exceção** | E1 – Crédito reprovado: sistema oferece a opção alternativa de pagamento de 50% adiantado e 50% após a entrega da mercadoria (regra 4.1). |
| **Pós-condições** | Resultado da análise registrado e condição de pagamento aplicada à cotação (UC01). |
| **Regras de Negócio** | Seções 4.1, 4.1.1 e 4.1.2. |


## 5.9 UC08 — Exportar/enviar orçamento


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Orçamento emitido (UC19), sem pendência de análise de crédito (UC07). |
| **Fluxo Principal** | 1. Operador conclui a emissão do orçamento (UC19). <br> 2. Sistema gera o documento do orçamento em PDF, com layout padronizado, numeração sequencial (mínimo de cinco dígitos), imposto destacado por item, validade de 30 dias e cláusula de consentimento LGPD no rodapé (RF12, RF20, regras 4.3 e 4.4). <br> 3. Operador salva, imprime ou envia o documento ao cliente. |
| **Fluxos Alternativos** | A1 – Envio realizado a partir de um pedido originado no Sistema 1 (UC10): orçamento retorna pronto ao vendedor para entrega ao cliente. |
| **Fluxos de Exceção** | E1 – Cotação com análise de crédito pendente (UC07): exportação bloqueada até a definição da condição de pagamento. |
| **Pós-condições** | Orçamento em PDF gerado e disponibilizado/enviado ao cliente, com prazo de validade de 30 dias para fechamento pelo preço ofertado (regra 4.4). |
| **Regras de Negócio** | RF12, RF20; regras 4.3 e 4.4. |


## 5.10 UC09 — Consultar painel de BI/Dashboard


Este caso de uso pertence ao Sistema 3 (Painel Gerencial). O Sistema 2 é responsável apenas por disponibilizar os dados agregados da cotação para exibição no painel (RF17); o layout e os demais indicadores pertencem ao escopo do Sistema 3.


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Gestor / Sistema 3 |
| **Pré-condições** | Gestor autenticado no Sistema 3; dados de cotação disponibilizados pelo Sistema 2 (RF17). |
| **Fluxo Principal** | 1. Gestor realiza login no Sistema 3. <br> 2. Painel de controle é exibido como primeira tela. <br> 3. Sistema 3 consome os dados agregados disponibilizados pelo Sistema 2: quantidade de orçamentos em aberto, orçamentos fechados (ACEITO) no dia, orçamentos recusados no dia e faturamento do dia e do mês (RF17). <br> 4. Sistema 3 exibe indicadores de BI, controle de vendas e gráficos de lucro. |
| **Fluxos Alternativos** | Não se aplica — este caso de uso pertence ao Sistema 3; o Sistema 2 apenas disponibiliza os dados agregados (RF17). |
| **Fluxos de Exceção** | E1 – Falha na disponibilização dos dados agregados pelo Sistema 2: painel exibe os últimos dados sincronizados. |
| **Pós-condições** | Indicadores de BI, controle de vendas e gráficos de lucro exibidos ao gestor. |
| **Regras de Negócio** | RF17. |


## 5.11 UC10 — Registrar e analisar pedido do Sistema 1


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Vendedor (Sistema 1) / Operador (Sistema 2) |
| **Pré-condições** | Vendedor autenticado no Sistema 1, com login unificado entre os sistemas (RF08); cliente cadastrado. |
| **Fluxo Principal** | 1. Vendedor registra um pedido de orçamento no Sistema 1: cliente, produtos desejados (variação, fardo ou avulso e quantidade) e configuração do pedido (endereço de entrega, número da solicitação de compra, contato e condições desejadas) (RF13). <br> 2. O backend do Sistema 1 grava o pedido e seus itens no banco compartilhado, através do proxy, com status SOLICITADO. <br> 3. O Sistema 2 exibe ao operador a lista de pedidos em aberto (SOLICITADO), atualizada conforme o Sistema 1 grava no banco. <br> 4. O operador seleciona um pedido; ele passa a EM_ANALISE e não pode ser assumido por outro operador. <br> 5. O operador avalia se é possível atender o pedido (estoque, situação do cliente e crédito). <br> 6. Sendo possível, aprova o pedido, monta o orçamento a partir dele (UC01) e o emite (UC19); o pedido passa a APROVADO e o orçamento fica vinculado a ele. <br> 7. Não sendo possível, nega o pedido e informa o motivo; o pedido passa a NEGADO. <br> 8. O Sistema 1 identifica, pelo status registrado no banco, que o orçamento está pronto (ou que o pedido foi negado, com o motivo) e o exibe ao vendedor (responsabilidade do Sistema 1). |
| **Fluxos Alternativos** | A1 – Sistema 1 sem conexão: o pedido é mantido no dispositivo e gravado quando a conexão for restabelecida (seção 3.2). <br> A2 – Vendedor cancela o pedido antes da análise: status CANCELADO. <br> A3 – Operador desiste da análise: devolve o pedido à lista (SOLICITADO). |
| **Fluxos de Exceção** | E1 – Cliente não cadastrado: o pedido não é gravado; o vendedor é orientado a solicitar o cadastro (UC02). <br> E2 – Cliente inativo, bloqueado ou com dívida em aberto (UC14): o operador nega o pedido informando o motivo. |
| **Pós-condições** | Pedido APROVADO, com orçamento emitido e disponível para o Sistema 1 (UC11), ou NEGADO, com o motivo registrado. |
| **Regras de Negócio** | RF08, RF13, RF23; seção 4.6. |


## 5.12 UC11 — Responder orçamento enviado


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Cliente, via vendedor no Sistema 1 |
| **Pré-condições** | Orçamento emitido (ABERTO), vinculado a um pedido e exibido ao vendedor pelo Sistema 1 (UC10). |
| **Fluxo Principal** | 1. Cliente recebe o orçamento, por intermédio do vendedor. <br> 2. Cliente decide, item a item, se aprova (com a quantidade aprovada, que pode ser menor que a cotada) ou não aprova; ou recusa o orçamento; ou solicita alteração (RF14, RF15). <br> 3. O vendedor registra a resposta no Sistema 1, com a justificativa quando houver; o Sistema 1 a grava no banco compartilhado com status PENDENTE (tabelas resposta_orcamento e item_resposta_orcamento). <br> 4. O Sistema 2 processa a resposta (UC20). O Sistema 1 exibe o último dado gravado. |
| **Fluxos Alternativos** | A1 – Aprovação parcial: os itens não aprovados permanecem NAO_APROVADO e o orçamento continua ABERTO; o vendedor pode registrar nova resposta a qualquer momento, até o vencimento. <br> A2 – Pedido de alteração: a resposta segue para tratamento do operador (UC21). <br> A3 – Nova versão do orçamento: o vendedor registra a confirmação do cliente sobre a nova versão; a aprovação dos itens herdados vem pré-preenchida, mas exige a confirmação do cliente. |
| **Fluxos de Exceção** | E1 – Cliente recusa: a justificativa é opcional; o campo pode ficar vazio (RF14). Processada a recusa, o orçamento passa a RECUSADO e a resposta segue para tratamento do operador (UC21). <br> E2 – Sistema 1 sem conexão: a resposta é mantida no dispositivo e gravada quando a conexão for restabelecida (seção 3.2). <br> E3 – Orçamento vencido (EXPIRADO) ou já encerrado: a resposta não é aceita. |
| **Pós-condições** | Resposta registrada como PENDENTE e, após o processamento (UC20), itens marcados e status do orçamento atualizados. |
| **Regras de Negócio** | RF14, RF15, RF16; seção 4.6. |


## 5.13 UC12 — Atualizar status de orçamento pendente


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Vendedor |
| **Pré-condições** | Orçamento emitido (ABERTO), sem aceite, a sete dias do vencimento de 30 dias (RF16). |
| **Fluxo Principal** | 1. Sistema identifica os orçamentos ABERTO com vencimento em até sete dias. <br> 2. O Sistema 1 exibe pop-up ao vendedor identificando o orçamento e solicitando atualização. <br> 3. Vendedor contata o cliente. <br> 4. Vendedor registra o resultado: manter em negociação (evento no histórico) ou cliente recusou (resposta de recusa pelo mesmo canal do UC11). |
| **Fluxos Alternativos** | A1 – Manter em negociação: o prazo de 30 dias não é estendido; para continuar após o vencimento, o operador cria uma nova versão (UC21). |
| **Fluxos de Exceção** | E1 – Cliente recusou: a resposta de recusa é gravada como PENDENTE e, após o processamento (UC20), o orçamento passa a RECUSADO, não permanecendo em aberto no sistema (seção 1.5, RF16). <br> E2 – Sem ação do vendedor: o orçamento expira aos 30 dias da emissão (EXPIRADO). |
| **Pós-condições** | Histórico atualizado, recusa registrada ou orçamento EXPIRADO. |
| **Regras de Negócio** | RF16. |


## 5.14 Detalhamento técnico do fluxo de orçamento (UC01)


Os casos de uso UC13 a UC19 descrevem, em maior granularidade e no nível de tela e de validação de sistema, os passos internos do UC01 — Gerar cotação. Nesta camada de detalhamento, o ator é o Operador (Sistema 2); o Vendedor atua no Sistema 1 e não executa os UC14 a UC19. As referências "RN01", "RN02" etc. indicadas no campo Regras de Negócio de cada caso de uso a seguir possuem numeração própria desta subseção e não devem ser confundidas com os requisitos funcionais (RF) ou as regras de negócio da seção 4. Os números RN12, RN16 e RN19 não são utilizados.


## 5.15 UC13 — Autenticar usuário


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Todos os perfis (VENDEDOR, OPERADOR, OPERADOR_CHEFE, FISCAL, FINANCEIRO e GESTOR) |
| **Pré-condições** | Usuário cadastrado, ativo e com um dos perfis do sistema. |
| **Fluxo Principal** | 1. Vendedor acessa a tela de login. <br> 2. Informa usuário e senha. <br> 3. Sistema criptografa e compara com a base. <br> 4. Sistema valida se o usuário está ativo. <br> 5. Sistema carrega perfil, permissões e carteira de clientes. <br> 6. Sistema abre a tela inicial (dashboard). |
| **Fluxos Alternativos** | A1 – "Esqueci minha senha": sistema envia link de redefinição ao e-mail corporativo. <br> A2 – Sessão ativa válida: sistema pula direto ao passo 6. |
| **Fluxos de Exceção** | E1 – Credenciais inválidas: erro exibido, retorna ao passo 2. <br> E2 – Três tentativas erradas: conta bloqueada temporariamente. <br> E3 – Usuário inativo/demitido: acesso negado. |
| **Pós-condições** | Sessão iniciada, token gerado e permissões carregadas. |
| **Regras de Negócio** | RN01 – Senha mínima de 8 caracteres. <br> RN02 – Sessão expira por inatividade. <br> RN03 – O vendedor (Sistema 1) só enxerga clientes da sua carteira; os operadores do Sistema 2 acessam todos os clientes. |


## 5.16 UC14 — Iniciar orçamento / selecionar cliente


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | UC13 concluído. |
| **Fluxo Principal** | 1. Operador aciona "Novo Orçamento". <br> 2. Informa CNPJ, razão social ou nome fantasia. <br> 3. Sistema consulta a base de clientes B2B. <br> 4. Sistema exibe a lista de resultados com status cadastral. <br> 5. Operador seleciona o cliente. <br> 6. Sistema carrega dados fiscais, endereço de entrega, prazo de pagamento e histórico de compras. <br> 7. Sistema gera o cabeçalho do rascunho (data de criação e operador); número, data de emissão e validade são atribuídos na emissão (UC19). <br> 8. Sistema abre o orçamento em rascunho. |
| **Fluxos Alternativos** | A1 – Cliente não encontrado: operador refina a busca ou cadastra o cliente (UC02). <br> A2 – Cliente com mais de um endereço de entrega: operador escolhe qual será usado. <br> A3 – Retomar rascunho: operador abre orçamento já iniciado. <br> A4 – Orçamento iniciado a partir de pedido do Sistema 1 (UC10): cliente e itens vêm do pedido. |
| **Fluxos de Exceção** | E1 – Cliente inativo/bloqueado: cotação não é aberta, motivo exibido. <br> E2 – Cliente inadimplente: sistema bloqueia automaticamente a abertura de nova cotação (RN06) até que a dívida seja renegociada e pago no mínimo 50% do valor devido. <br> E3 – Falha na base de dados: rascunho não é criado, erro registrado em log. |
| **Pós-condições** | Orçamento em rascunho criado e vinculado ao cliente. |
| **Regras de Negócio** | RN04 – Preço é único por produto/variação, sem tabela diferenciada por cliente; aplica-se desconto progressivo por faixa de quantidade, com preço próprio para fardo fechado e preço por faixa para venda avulsa (RN07/RN08, seção 5.17). <br> RN05 – Orçamento tem prazo de validade de 30 dias (os 7 dias tratados na regra 4.5/RF16 são o prazo de follow-up do operador, não a validade do preço). <br> RN06 – Cliente com dívida em aberto não tem nova compra liberada automaticamente; a liberação exige renegociação com pagamento de no mínimo 50% do valor devido, após o que a nova compra segue a análise de crédito normal (seção 4.1) para definir a forma de pagamento. Se o cliente não aceitar renegociar, a venda não é realizada; após 60 dias de atraso no pagamento, a dívida deve ser protestada. <br> RN25 – Rascunho não recebe número, não reserva estoque e expira após 30 dias sem edição (EXPIRADO), sendo apagado 30 dias depois. |


## 5.17 UC15 — Buscar e filtrar produtos


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | UC14 concluído (rascunho aberto). |
| **Fluxo Principal** | 1. Operador acessa o catálogo dentro do orçamento. <br> 2. Digita descrição, código interno ou EAN. <br> 3. Aplica filtros de marca e peso/variação (ex.: arroz 1 kg × 5 kg). <br> 4. Sistema consulta o catálogo aplicando o preço por faixa de quantidade e a modalidade de compra (fardo fechado ou avulso). <br> 5. Sistema retorna os itens com descrição, marca, peso, preço por faixa de quantidade (avulso), preço do fardo fechado, unidades por fardo e indicador de disponibilidade. |
| **Fluxos Alternativos** | A1 – Busca por categoria/departamento em vez de texto. <br> A2 – Repetir último pedido: sistema sugere itens do histórico do cliente. <br> A3 – Ordenar resultados por preço ou marca. |
| **Fluxos de Exceção** | E1 – Nenhum resultado: sistema informa e sugere remover filtros. <br> E2 – Produto descontinuado: exibido como indisponível, sem opção de adicionar. <br> E3 – Timeout na consulta: mensagem de erro e opção de nova tentativa. |
| **Pós-condições** | Lista de produtos disponíveis exibida. |
| **Regras de Negócio** | RN07 – Fardo fechado tem preço próprio e fixo por pacote (ex.: fardo com 6 ou 10 unidades). <br> RN08 – Venda avulsa segue desconto progressivo por faixa de quantidade do mesmo item (ex.: 1 a 3 unidades = R$ 25,00 cada; a partir de 4 unidades = R$ 19,00 cada); o cliente escolhe entre fardo fechado ou avulso conforme a necessidade. <br> RN09 – Filtros de marca e peso são cumulativos. |


## 5.18 UC16 — Adicionar item ao orçamento


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | UC15 com produto localizado. |
| **Fluxo Principal** | 1. Operador seleciona o produto na lista. <br> 2. Define a granularidade: fardo fechado ou pacote avulso. <br> 3. Informa a quantidade desejada. <br> 4. Sistema converte a quantidade em unidades (qtd × unidades por fardo, se fardo). <br> 5. Sistema aciona UC17 — Validar Estoque (sem reservar). <br> 6. Com saldo confirmado, o sistema calcula o valor da linha = quantidade × valor unitário (conforme granularidade). <br> 7. Sistema insere a linha na grade do orçamento. <br> 8. Sistema recalcula o subtotal e atualiza a tela. <br> 9. Operador decide adicionar mais itens (volta ao UC15) ou finalizar (UC19). |
| **Fluxos Alternativos** | A1 – Item já consta no orçamento: sistema soma as quantidades na mesma linha. <br> A2 – Editar linha: operador altera quantidade/granularidade e o sistema recalcula. <br> A3 – Remover linha: sistema exclui o item e recalcula o subtotal. |
| **Fluxos de Exceção** | E1 – Estoque zerado (UC17): adição bloqueada, alerta exibido, retorna ao UC15. <br> E2 – Saldo parcial: sistema informa a quantidade máxima e pede confirmação. <br> E3 – Quantidade inválida (zero, negativa ou não inteira): campo rejeitado. |
| **Pós-condições** | Item incluído, valor da linha calculado e subtotal atualizado. |
| **Regras de Negócio** | RN10 – Fardo fechado só aceita quantidade inteira. <br> RN11 – Preço do avulso é maior que o proporcional do fardo. <br> RN13 – Subtotal = soma de todas as linhas. |


## 5.19 UC17 — Validar estoque


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Sistema (acionado no UC16) |
| **Pré-condições** | Produto, granularidade e quantidade informados. |
| **Fluxo Principal** | 1. Sistema identifica o SKU (variação de produto). <br> 2. Converte a quantidade solicitada para a unidade de estoque. <br> 3. Consulta o saldo disponível em tempo real (saldo físico − reservas vigentes). <br> 4. Compara saldo disponível × quantidade solicitada. <br> 5. Confirma a disponibilidade e libera a inclusão. Nenhuma reserva é criada no rascunho; as reservas são criadas na emissão (UC19). |
| **Fluxos Alternativos** | Não se aplica. |
| **Fluxos de Exceção** | E1 – Estoque zerado: inclusão bloqueada e alerta emitido. <br> E2 – Saldo insuficiente: sistema informa o máximo disponível. <br> E3 – Consulta ao banco compartilhado (via proxy) indisponível ou em timeout: inclusão bloqueada; o sistema informa o erro e solicita que o operador tente novamente. |
| **Pós-condições** | Disponibilidade confirmada (sem reserva), ou inclusão bloqueada. |
| **Regras de Negócio** | RN14 – Saldo considerado é o disponível (físico − reservas vigentes), não o físico. <br> RN15 – As reservas são criadas na emissão do orçamento e expiram junto com a validade. |


## 5.20 UC18 — Calcular condições comerciais


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Sistema (acionado no UC19) |
| **Pré-condições** | Orçamento com ao menos um item válido. |
| **Fluxo Principal** | 1. Sistema apura o subtotal dos itens (soma dos totais das linhas, já com o imposto de 18% de cada linha — regra 4.3). <br> 2. Dispara em paralelo: (A) Faturamento mínimo — compara o subtotal com o valor mínimo de pedido; (B) Frete — se o total ≥ valor-limite, aplica CIF (frete grátis/embutido); se < limite, aplica FOB (frete cotado com a transportadora ou indicado pelo cliente); (C) Crédito — consulta o resultado da análise de crédito (aprovado, reprovado ou pendente, registrado em analise_credito) e a situação de inadimplência do cliente. <br> 3. Sistema sincroniza os três resultados. <br> 4. Aplica o frete apurado em (B): valor destacado quando FOB cotado, provisório quando ainda sem cotação, nenhum valor quando CIF. Imposto e descontos por faixa de quantidade já estão nos itens e não são recalculados. <br> 5. Consolida o valor total da proposta = subtotal dos itens (com imposto) + frete destacado, quando houver; o valor do imposto é totalizado à parte, apenas para exibição. <br> 6. Retorna o resultado ao UC19. |
| **Fluxos Alternativos** | A1 – Cliente com frete CIF contratual: regra B é ignorada e aplica-se CIF direto. <br> A2 – Crédito reprovado: sistema oferece a condição de 50% adiantado e 50% após a entrega da mercadoria (regra 4.1). <br> A3 – Pagamento antecipado: análise de crédito é dispensada. <br> A4 – Verificação no aceite (UC20): as verificações de faturamento mínimo e de frete são reaplicadas sobre o total do orçamento aceito. |
| **Fluxos de Exceção** | E1 – Faturamento mínimo não atingido: finalização bloqueada, operador orientado a incluir mais itens. <br> E2 – Análise de crédito pendente: cotação fica no status PENDENTE_CREDITO até a equipe fiscal concluir a análise (UC07); a emissão fica bloqueada nesse intervalo. <br> E3 – Frete FOB ainda sem valor cotado com a transportadora: o cálculo devolve o frete como provisório, sem exceção, e o sistema sinaliza a provisoriedade no orçamento. |
| **Pós-condições** | Totais consolidados, modalidade de frete definida e situação de crédito apurada. |
| **Regras de Negócio** | RN17 – Pedido abaixo do mínimo não é faturado. <br> RN18 – CIF acima do valor-limite, FOB abaixo. <br> RN20 – As três verificações são independentes e simultâneas. |


## 5.21 UC19 — Gerar orçamento seguro


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | UC18 executado, sem bloqueios pendentes. |
| **Fluxo Principal** | 1. Operador aciona "Finalizar Orçamento". <br> 2. Sistema executa UC18, valida os resultados e verifica novamente o saldo de estoque de todos os itens. <br> 3. Sistema compila o documento: cabeçalho (cliente, operador, nº, data, validade), grade de itens (descrição, marca, peso, granularidade, quantidade, valor unitário, valor da linha) e rodapé de totais (subtotal, frete/modalidade, impostos, total). <br> 4. Sistema gera a chave de segurança (hash/código de validação antifraude) a partir do conteúdo do orçamento. <br> 5. Sistema atribui o número sequencial do orçamento, define a data de emissão e a validade (emissão + 30 dias), cria as reservas de estoque com status CONFIRMADA (uma por item), grava o orçamento com status ABERTO e registra em log (usuário, data/hora, IP). <br> 6. Sistema renderiza o PDF com a chave impressa. <br> 7. Operador salva, imprime ou envia ao cliente. <br> 8. Sistema confirma a operação e encerra o fluxo. |
| **Fluxos Alternativos** | A1 – Envio por e-mail: sistema dispara o PDF ao contato do cliente e registra o envio. <br> A2 – Salvar como rascunho: documento não é emitido nem recebe chave. <br> A3 – Converter em venda: o orçamento aceito segue para faturamento (fluxo fora do escopo deste módulo). <br> A4 – Alteração de orçamento já emitido: cria-se uma nova versão, com número novo e nova chave, vinculada ao original (UC21). |
| **Fluxos de Exceção** | E1 – Regras comerciais não atendidas (UC18): emissão bloqueada com o motivo. <br> E2 – Falha na geração do PDF: rascunho preservado e erro registrado. <br> E3 – Falha ao gravar no banco: transação revertida (rollback) integralmente. <br> E4 – Chave duplicada: sistema regenera automaticamente. <br> E5 – Saldo de estoque insuficiente na emissão (o rascunho não reserva estoque): emissão bloqueada com a mensagem “Estoque insuficiente para emitir: {produto}. Disponível: {X}; no orçamento: {Y}. Ajuste a quantidade ou remova o item.”; o rascunho permanece intacto para o operador ajustar e emitir de novo. <br> E6 – Falha ao criar as reservas: transação revertida integralmente. |
| **Pós-condições** | Orçamento emitido, persistido, numerado, com reservas CONFIRMADA, PDF e chave de validação disponíveis para envio. |
| **Regras de Negócio** | RN21 – Todo orçamento emitido tem chave única e irrepetível. <br> RN22 – Documento emitido é imutável; alteração exige nova versão. <br> RN23 – A chave permite validar a autenticidade do PDF no sistema. <br> RN24 – Após o vencimento da validade, os preços precisam ser revalidados. |


## 5.22 UC20 — Processar resposta do cliente


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Sistema (Sistema 2) |
| **Pré-condições** | Resposta gravada pelo Sistema 1 com status PENDENTE (UC11); orçamento em ABERTO. |
| **Fluxo Principal** | 1. O Sistema 2 identifica as respostas com status PENDENTE. <br> 2. Em caso de recusa: o orçamento passa a RECUSADO, as reservas são liberadas e a resposta segue para tratamento do operador (UC21). Em caso de pedido de alteração: o orçamento passa a ALTERACAO_SOLICITADA e a resposta segue para tratamento (UC21). <br> 3. Em caso de aprovação por item: o sistema considera a quantidade aprovada de cada item; quantidade zero equivale a NAO_APROVADO. <br> 4. O sistema recalcula o preço dos itens avulsos aprovados pela faixa da quantidade aprovada (o fardo mantém o preço fixo) e o imposto por linha (regra 4.3), e grava o valor consolidado. <br> 5. Se ainda houver item não aprovado, o orçamento continua ABERTO e a resposta segue para tratamento do operador (motivo ITENS_NAO_APROVADOS). <br> 6. Se todos os itens estão aprovados, o sistema verifica o faturamento mínimo e o frete (UC18) sobre o total aceito. <br> 7. Atendidas as regras, o sistema grava o total aceito, o frete e o valor final, muda o orçamento para ACEITO, baixa o estoque dos itens aprovados (reservas BAIXADA; movimentação BAIXA) e marca a resposta como CONSOLIDADA. <br> 8. O Sistema 1 exibe ao vendedor o último dado gravado. |
| **Fluxos Alternativos** | A1 – Resposta sobre uma nova versão (UC21): segue o mesmo fluxo; a aprovação pré-preenchida dos itens herdados só vale com a confirmação do cliente. |
| **Fluxos de Exceção** | E1 – Total aceito abaixo do faturamento mínimo (a partir da segunda compra): o orçamento não é aceito e a resposta segue para tratamento do operador (motivo ABAIXO_DO_MINIMO). <br> E2 – Falha ao gravar: transação revertida integralmente; a resposta permanece PENDENTE. |
| **Pós-condições** | Resposta CONSOLIDADA ou aguardando o operador; orçamento ABERTO, ACEITO, RECUSADO ou ALTERACAO_SOLICITADA. |
| **Regras de Negócio** | RF14, RF15, RF16, RF17; regras 4.1, 4.2 e 4.3; seção 4.6. |


## 5.23 UC21 — Tratar resposta pendente e criar nova versão do orçamento


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador |
| **Pré-condições** | Existe resposta aguardando o operador: recusa, pedido de alteração, itens não aprovados ou total abaixo do mínimo (UC20). |
| **Fluxo Principal** | 1. O operador abre a tela “Respostas pendentes”, que lista as respostas com tipo, orçamento, vendedor e data (RF27). <br> 2. Seleciona uma resposta e lê a justificativa informada e a situação dos itens (cotado × aprovado). <br> 3. Aciona “Criar nova versão”: o sistema cria um novo orçamento em rascunho, copiando itens e condições, com vínculo ao original (id_orcamento_origem); os itens aprovados herdam a marca de aprovado. <br> 4. O operador reestrutura o orçamento conforme a requisição do vendedor (UC05, UC16): qualquer item pode ser alterado ou removido; alterar a quantidade ou o item o devolve a não aprovado; remover um item não afeta os demais. <br> 5. Ao emitir (UC19), a nova versão recebe número novo, validade de 30 novos dias, chave de segurança nova e novas reservas; o orçamento original passa a SUBSTITUIDO, suas reservas são liberadas e a resposta é marcada como TRATADA. <br> 6. O vendedor registra no Sistema 1 a confirmação do cliente sobre a nova versão (UC11). |
| **Fluxos Alternativos** | A1 – Recusa sem reestruturar: o operador marca a resposta como TRATADA sem criar nova versão; o orçamento permanece RECUSADO. <br> A2 – Cliente desiste da alteração: o operador cancela o rascunho da nova versão (UC06); o orçamento original permanece como estava até expirar. |
| **Fluxos de Exceção** | E1 – Orçamento original já ACEITO, cancelado, substituído ou expirado: nova versão não permitida. <br> E2 – Total da nova versão abaixo do faturamento mínimo: emissão bloqueada (UC18). |
| **Pós-condições** | Nova versão emitida (ABERTO), original SUBSTITUIDO (ou RECUSADO, tratado) e resposta TRATADA. |
| **Regras de Negócio** | RF21, RF27; RN22, RN24; regras 4.4 e 4.6. |


## 5.24 UC22 — Cadastrar fornecedor


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador chefe |
| **Pré-condições** | Operador autenticado; fornecedor ainda não cadastrado na base. |
| **Fluxo Principal** | 1. Operador acessa a tela de cadastro de fornecedor. <br> 2. Informa CNPJ, razão social e dados de contato. <br> 3. Sistema salva o cadastro. |
| **Fluxos Alternativos** | Não se aplica. |
| **Fluxos de Exceção** | E1 – CNPJ já cadastrado: o sistema informa e abre o cadastro existente. |
| **Pós-condições** | Fornecedor disponível para seleção na entrada de mercadoria (UC04). |
| **Regras de Negócio** | RF22. |


## 5.25 UC23 — Registrar dívida e renegociação


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Financeiro |
| **Pré-condições** | Usuário com perfil FINANCEIRO autenticado; cliente cadastrado. |
| **Fluxo Principal** | 1. O financeiro busca o cliente por CNPJ. <br> 2. Registra a dívida: valor e data de vencimento original. <br> 3. O sistema passa a bloquear a abertura de novos orçamentos do cliente (RN06). <br> 4. Havendo renegociação, o financeiro registra a data e o valor pago (mínimo de 50% da dívida); a dívida passa a RENEGOCIADA e o cliente segue para a análise de crédito normal (seção 4.1). <br> 5. Quitada a dívida, o financeiro a marca como QUITADA. |
| **Fluxos Alternativos** | A1 – Dívida sem renegociação após 60 dias de atraso: um job muda o status para PROTESTADA e grava a data do protesto (seção 13.4). |
| **Fluxos de Exceção** | E1 – Valor pago inferior a 50% da dívida: renegociação não registrada. |
| **Pós-condições** | Dívida atualizada; a abertura de orçamentos do cliente fica bloqueada ou liberada conforme o status. |
| **Regras de Negócio** | RF25; RN06; seção 13.4. |


## 5.26 UC24 — Ajustar estoque


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador chefe |
| **Pré-condições** | Usuário com perfil OPERADOR_CHEFE autenticado; variação de produto cadastrada. |
| **Fluxo Principal** | 1. O operador chefe busca a variação de produto. <br> 2. Informa a quantidade a somar ou subtrair e o motivo do ajuste. <br> 3. O sistema registra a movimentação AJUSTE e atualiza o estoque físico da variação. |
| **Fluxos Alternativos** | Não se aplica. |
| **Fluxos de Exceção** | E1 – Motivo em branco: ajuste bloqueado. <br> E2 – O ajuste deixaria o estoque físico abaixo do total reservado (reservas CONFIRMADA): ajuste bloqueado. |
| **Pós-condições** | Movimentação registrada no histórico de estoque e saldo atualizado. |
| **Regras de Negócio** | RF26. |


## 5.27 UC25 — Gerenciar usuários


| **Campo** | **Conteúdo** |
|---|---|
| **Ator(es)** | Operador chefe |
| **Pré-condições** | Usuário com perfil OPERADOR_CHEFE autenticado. |
| **Fluxo Principal** | 1. O operador chefe acessa a gestão de usuários. <br> 2. Cria um usuário (usuário, e-mail e perfil) ou altera o perfil de um existente. <br> 3. O sistema grava o usuário e envia o link de definição de senha ao e-mail cadastrado. <br> 4. Para inativar um usuário, o operador chefe muda o status para INATIVO; se for vendedor com clientes na carteira, indica o novo vendedor responsável. |
| **Fluxos Alternativos** | Não se aplica. |
| **Fluxos de Exceção** | E1 – Inativação de vendedor com clientes sem indicar o novo responsável: bloqueada. <br> E2 – Usuário ou e-mail já cadastrado: bloqueado. |
| **Pós-condições** | Usuário criado, alterado ou inativado; carteira de clientes reatribuída quando aplicável. |
| **Regras de Negócio** | RF24; RN01. |
