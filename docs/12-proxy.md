# 12. Proxy de Comunicação


O proxy é um sistema próprio, hospedado no Render, responsável por intermediar tanto a comunicação entre os três sistemas quanto a comunicação de cada sistema com o banco de dados compartilhado (Supabase). Não é um módulo embutido no backend de um sistema específico — é um serviço central e independente, que atua como camada de autorização e controle de acesso: toda operação que um sistema deseja executar sobre o banco compartilhado é submetida ao proxy, que verifica autorização e risco estrutural antes de liberar a execução. Em vez de expor um catálogo de rotas específicas por domínio de negócio, o proxy expõe um contrato único de execução de operações (seção 12.2), o que reduz a superfície de contrato a manter e torna o serviço independente da granularidade final do modelo de dados compartilhado. Para os sistemas que o utilizam, o proxy é uma barreira transparente: existe e deve ser aplicado em toda comunicação, mas funciona como um backend adicional, sem exigir que o sistema chamador conheça mais que o endereço do serviço e a sua credencial.


## 12.1 Responsabilidades

- Intermediar toda comunicação entre Sistema 1, Sistema 2 e Sistema 3 — nenhum sistema se comunica diretamente com outro. A troca de informações entre os sistemas ocorre por registros no banco (por exemplo, pedido e resposta pendente), gravados e lidos através do proxy.
- Ser o único ponto autorizado a abrir conexão com o banco de dados compartilhado.
- Validar e sanitizar toda query antes de executar.
- Verificar o risco estrutural de cada operação antes de autorizá-la — situações que possam comprometer a integridade dos dados (exclusão em massa, perda irreversível de registros) ou a integridade do sistema (alterações que rompam relacionamentos entre entidades ou extrapolem o escopo esperado para a operação solicitada) — bloqueando sua execução quando identificadas.
- Gerenciar a fila de escrita (seção 12.5), já que o banco é compartilhado pelos três sistemas.
- Suportar o fluxo de resiliência do RNF06: recebe a atualização do frontend com validação no backend e, em paralelo, envia para a pilha de atualizações, evitando perda de progresso em caso de queda de conexão.

## 12.2 Protocolo e Contrato de Operações


Protocolo REST, com dados trafegados em JSON. O proxy expõe um único ponto de entrada de execução (POST /executar), por meio do qual os Sistemas 1, 2 e 3 submetem operações sobre o banco de dados compartilhado. Cada requisição é composta por um envelope com dois campos: operacao (identificador da operação) e payload (dados necessários à execução).


Modelo híbrido. As operações se dividem em três famílias: (a) operações genéricas dados.*, que servem para qualquer tabela do banco e tornam o proxy dinâmico — uma tabela ou coluna nova passa a ser acessível sem alterar o proxy, que descobre a estrutura pelo próprio banco; (b) poucas operações nomeadas — pedido.assumir, orcamento.emitir e resposta.processar — reservadas ao que exige transação única e regra atômica (seção 12.5); (c) a administração de integrantes (integrante.criar e integrante.revogar), restrita à chave mestra.


Fluxo de cada requisição. O proxy valida o envelope e o payload, confere o token e o escopo do integrante (seção 12.3), executa a verificação de risco estrutural (seções 12.1 e 12.4) e, somente em caso de aprovação, executa a operação. Não há SQL bruto: o proxy monta a instrução parametrizada a partir do payload declarativo, e os nomes de tabelas e colunas são validados contra a estrutura real do banco.


As regras de integridade que valem para qualquer integrante — imutabilidade do orçamento emitido, teto de reserva de estoque, atribuição do número do orçamento e as demais da seção 13.4 — ficam em gatilhos e restrições do banco; o proxy apenas transporta a operação. O contrato de cada operação está no catálogo (seção 12.8).


## 12.3 Autenticação e acesso


O acesso ao proxy é restrito e exige autenticação por token de serviço. As credenciais fixas do proxy (conexão com o Supabase e a chave mestra do mecanismo de provisionamento) são gerenciadas por meio de variáveis de ambiente (env). Os tokens de cada integrante (Sistema 1, Sistema 2 e Sistema 3), por sua vez, são emitidos dinamicamente pelo próprio mecanismo de criação de integrantes, e não ficam fixos em env — isso permite adicionar, rotacionar ou revogar um integrante sem redeploy do proxy. O backend próprio do Sistema 1 recebe o seu token de integrante por variável de ambiente (env) e o utiliza em todas as requisições ao proxy.


Escopos do token: têm o formato tabela:acao, com acao em consultar, inserir, atualizar ou excluir (por exemplo, pedido:inserir); o curinga * vale para todas as tabelas; rpc:<funcao> autoriza dados.rpc para uma função do banco; operacao:<identificador> autoriza uma operação nomeada. Colunas sensíveis (senha_hash, token_recuperacao_senha e validade_token) nunca são devolvidas por dados.consultar, exceto ao integrante que possua o escopo operador.credenciais:consultar, concedido apenas ao sistema que autentica usuários.


**Variáveis de ambiente (fixas, do proxy):** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (conexão com o banco); PROXY_ADMIN_KEY (chave mestra, única credencial autorizada a criar novos integrantes); JWT_SIGNING_SECRET (assinatura dos tokens de integrante); PORT; ENV (dev/homologação/produção).


**Token de integrante (JWT):** emitido pelo mecanismo de criação de integrantes a partir da PROXY_ADMIN_KEY, contendo service_id, escopos permitidos, origens associadas, issued_at e expires_at.


**Headers obrigatórios em toda requisição ao proxy:** Authorization (Bearer <token do integrante>); X-Timestamp (horário de envio da requisição, usado para rejeitar requisições repetidas/atrasadas além de uma tolerância definida — proteção contra replay); X-Service-Id (identificação do sistema requisitante); X-Operation-Id (identificação do processo/operação requisitado, usada no log de auditoria).


## 12.4 Segurança


A segurança do proxy é composta de conjunto de contramedidas complementares, cada uma cobrindo um vetor de ataque diferente.

- Autenticação por token de serviço (seção 12.3) — barra qualquer chamada que não apresente credencial válida; só quem possui o token consegue falar com o proxy.
- Escopo por tabela e ação (seção 12.3) — cada integrante só executa o que consta em seu token, inclusive nas operações genéricas dados.*.
- Validação e sanitização de queries (seção 12.1) — nenhuma instrução chega ao banco sem antes ser validada e sanitizada pelo proxy, mitigando injeção de dados maliciosos.
- Verificação de risco estrutural (seção 12.1) — antes de executar qualquer operação aprovada na etapa de autorização, o proxy avalia se ela representa risco à integridade dos dados ou do sistema (ex.: exclusão em massa, alteração que rompe relacionamento entre entidades), bloqueando sua execução quando identificado. Nas operações genéricas, dados.atualizar e dados.excluir sem filtro, ou que afetariam mais de 50 linhas, são bloqueados.
- Rate limiting — aplicado às requisições recebidas pelo proxy, para conter abuso, força bruta e picos anômalos de tráfego. Bibliotecas sugeridas (stack Node.js/Express, já definida para o backend): express-rate-limit, implementação simples em memória, suficiente para uma instância única como é o caso do proxy hospedado no Render; ou rate-limiter-flexible, mais flexível, permitindo trocar o armazenamento (memória, Redis) caso seja necessário escalar para múltiplas instâncias no futuro.
- Ocultação de dados internos em erros (seção 12.6) — mesmo em caso de falha, apenas códigos e mensagens corporativas genéricas chegam ao cliente, sem expor detalhes estruturais do banco de dados.

## 12.5 Fila de escrita


Como o proxy é o único autorizado a escrever no banco compartilhado, ele precisa organizar essas escritas para evitar conflito entre os três sistemas. O sistema adota do seguinte método de organização:

- Fila persistida no banco (padrão outbox): uma tabela auxiliar no Supabase (ex.: fila_escrita) registra cada operação pendente como uma linha; um worker do proxy processa essa tabela em ordem (FIFO) e marca como concluída. Sobrevive a reinícios do serviço e não exige infraestrutura nova.

**Schema da tabela fila_escrita:** id; sistema_origem; dominio; operacao; payload (jsonb); status (pendente | processando | concluido | erro); tentativas; criado_em; atualizado_em; erro_mensagem.


Operações síncronas: o chamador aguarda a conclusão da gravação. As escritas (dados.inserir, dados.atualizar, dados.excluir, dados.lote, dados.rpc que altere dados e as operações nomeadas) passam pela fila; dados.consultar não. A fila garante a ordem das escritas, mas a resposta só é devolvida depois de gravada. pedido.assumir, orcamento.emitir e resposta.processar são operações únicas, executadas em transação, que devolvem o resultado ao chamador; pedido.assumir só tem efeito se o pedido ainda estiver SOLICITADO, o que impede dois operadores de assumirem o mesmo pedido.


## 12.6 Tratamento de erros


Os erros são tratados por uma classe de erro customizada (AppError, com código interno, status HTTP e mensagem), permitindo mensagens de negócio específicas (ex.: "CreditoReprovado", "EstoqueIndisponivel") e notificações personalizadas por tipo de erro. A biblioteca http-errors é utilizada para padronizar a criação e o retorno dos erros HTTP (ex.: 400, 404), mas não cobre notificação, que permanece específica do domínio via AppError. Essa combinação garante que apenas códigos e mensagens corporativas genéricas cheguem ao cliente, sem expor detalhes estruturais do banco de dados (nomes de tabelas, colunas, mensagens de erro do driver do Supabase etc.).


**Catálogo de mensagens:** mantido como um objeto (dicionário código → mensagem) em módulo próprio, consultado pelo AppError; cresce sob demanda conforme novos códigos são criados durante o desenvolvimento. Todo AppError novo deve ter entrada correspondente antes de ir para produção — na ausência de entrada, cai no fallback genérico (INTERNAL_ERROR), evitando vazamento acidental de mensagem não revisada. Exemplos iniciais: AUTH_INVALID_TOKEN, AUTH_EXPIRED, RATE_LIMIT_EXCEEDED, VALIDATION_ERROR, CreditoReprovado, EstoqueIndisponivel, NOT_FOUND, INTERNAL_ERROR.


## 12.7 Log e auditoria


O log de auditoria faz o tracing das interações (timestamp, origem, operação executada, resultado da verificação de risco, resultado da execução), utilizando bibliotecas como winston ou pino para estruturar e emitir os registros.


Decisão de infraestrutura: o Render (plano gratuito) tem sistema de arquivos efêmero — um arquivo de log local seria apagado sempre que o serviço reinicia ou hiberna por inatividade. Por isso, os logs não são gravados em arquivo local: winston/pino são configurados com um transporte que grava cada entrada diretamente em uma tabela do Supabase (ex.: log_auditoria), garantindo persistência independentemente de reinícios ou hibernação do serviço.


**Schema da tabela log_auditoria:** id; timestamp; sistema_origem; operacao; resultado_verificacao_risco; status_execucao; duracao_ms; request_id; resultado; id_usuario; ip_origem.


**Schema da tabela integrantes_proxy:** id; nome_sistema; chave_hash; escopos; ativo; criado_em; expira_em.


## 12.8 Catálogo de Operações


O catálogo reúne, para cada operação reconhecida pelo proxy (seção 12.2), o identificador, o payload de entrada e o retorno. Conteúdo referente somente ao Sistema 2: os escopos propostos para os Sistemas 1 e 3 (seção 12.8.5) derivam do uso previsto na seção 13.6 e não foram validados com os respectivos grupos.


### 12.8.1 Formato comum


Requisição: POST /executar com { "operacao": "<identificador>", "payload": { ... } } e os cabeçalhos obrigatórios da seção 12.3. Sucesso: { "ok": true, "dados": ..., "afetados": n, "proximo_cursor": ... }, com os campos que a operação define. Erro: { "ok": false, "erro": { "codigo": "ESCOPO_NEGADO", "mensagem": "..." } }, com o status HTTP do código (seção 12.8.6); apenas códigos e mensagens genéricas chegam ao cliente (seção 12.6).


### 12.8.2 Operações genéricas (dados.*)


Servem para qualquer tabela do banco compartilhado, sujeitas ao escopo do integrante. Regras do payload: filtros é { "e": [ [campo, operador, valor], ... ] } ou { "ou": [ ... ] }, com os operadores =, !=, >, >=, <, <=, em, contem, nulo e nao_nulo; incluir lista tabelas relacionadas por chave estrangeira, devolvidas aninhadas; agregacoes é [ { "fn": "soma", "campo": "valor_total_proposta", "como": "total" } ], com fn em contar, soma, media, minimo e maximo, combinada com agrupar; o limite padrão é 50 e o máximo é 500, com paginação por cursor.


| **Identificador** | **Payload de entrada** | **Retorno** |
|---|---|---|
| dados.consultar | { tabela (obrigatório); campos?; filtros?; incluir?; agrupar?; agregacoes?; ordenacao?: [ [campo, "asc"\|"desc"] ]; limite?; cursor? } | { ok, dados: [ {campo: valor} ], proximo_cursor: string \| null } |
| dados.inserir | { tabela; valores: {campo: valor} \| [ {...} ]; retornar?: [campos] } | { ok, dados: [linhas inseridas], afetados } |
| dados.atualizar | { tabela; filtros (obrigatório); valores: {campo: valor}; retornar?: [campos] } | { ok, afetados, dados? } |
| dados.excluir | { tabela; filtros (obrigatório) } | { ok, afetados } |
| dados.lote | { passos: [ { id, operacao, payload } ] } — somente operações dados.consultar, dados.inserir, dados.atualizar e dados.excluir. Um passo pode usar o resultado de outro: "$p1.dados[0].id_pedido". | { ok, resultados: { <id do passo>: <retorno da operação> } } — execução atômica: se um passo falhar, nenhum é aplicado. |
| dados.rpc | { funcao; argumentos: {nome: valor} } — apenas funções do banco autorizadas pelo escopo rpc:<funcao>. | { ok, resultado } |


### 12.8.3 Operações nomeadas


Existem porque exigem transação única e regra atômica que não se resolvem em passos independentes.


| **Identificador** | **Payload de entrada** | **Efeito e retorno** |
|---|---|---|
| pedido.assumir | { id_pedido, id_operador } | Muda o pedido de SOLICITADO para EM_ANALISE e grava id_operador_atendimento, somente se ele ainda estiver SOLICITADO. <br> Retorno: { ok, dados: pedido }. Erro: PEDIDO_JA_ASSUMIDO. |
| orcamento.emitir | { id_orcamento, id_operador, chave_seguranca }   // a chave é gerada pelo backend | Em uma transação: confere o saldo de cada item; obtém o número da sequence; grava numero_orcamento, data_emissao, data_validade (emissão + 30 dias) e chave_seguranca; cria as reservas CONFIRMADA; muda o orçamento para ABERTO; muda o pedido de origem para APROVADO; e, se for nova versão, muda o original para SUBSTITUIDO e libera suas reservas. <br> Retorno: { ok, dados: { id_orcamento, numero_orcamento, data_validade } }. Erros: ESTOQUE_INSUFICIENTE (com produto, disponível e quantidade no orçamento), ORCAMENTO_NAO_EDITAVEL, CHAVE_DUPLICADA. |
| resposta.processar | { id_resposta, resultado: { status_resposta, motivo_tratamento?, itens: [ { id_item_resposta, situacao, id_faixa_preco_aceita?, preco_unitario_aceito?, valor_imposto_aceito?, valor_total_item_aceito? } ], totais?: { valor_total_itens_aprovado, valor_total_imposto_aprovado, modalidade_frete_aceita?, valor_frete_aceito?, valor_total_aceito? }, status_orcamento } }   // valores calculados pelo módulo de cálculo (seção 11.6) | Em uma transação: grava os valores nos itens e na resposta; muda o orçamento para ACEITO, RECUSADO, ALTERACAO_SOLICITADA ou mantém ABERTO; no ACEITO, muda as reservas dos itens aprovados para BAIXADA, registra as movimentações BAIXA e libera as demais reservas. <br> Retorno: { ok, dados: { status_orcamento, status_resposta } }. Erro: RESPOSTA_JA_PROCESSADA. |


### 12.8.4 Administração de integrantes


| **Identificador** | **Payload de entrada** | **Retorno** |
|---|---|---|
| integrante.criar | { nome_sistema, escopos: [ "tabela:acao", ... ], expira_em? } — exige a PROXY_ADMIN_KEY | { ok, dados: { service_id, token } } — o token é exibido uma única vez; apenas o hash é guardado em integrantes_proxy. |
| integrante.revogar | { service_id } — exige a PROXY_ADMIN_KEY | { ok } — o integrante passa a ativo = false e seus tokens deixam de valer. Para rotacionar, revoga-se e cria-se outro. |


### 12.8.5 Escopos iniciais por integrante


| **Integrante** | **Consulta (dados.consultar)** | **Gravação e operações nomeadas** |
|---|---|---|
| Sistema 2 (backend) | Todas as tabelas (*:consultar), inclusive operador.credenciais:consultar. | *:inserir e *:atualizar. *:excluir apenas em item_orcamento, anexo_orcamento, endereco_cliente e orcamento em RASCUNHO. <br> operacao:pedido.assumir, operacao:orcamento.emitir e operacao:resposta.processar; dados.lote e rpc:*. |
| Sistema 1 (backend) — proposto | cliente, endereco_cliente, produto, variacao_produto, faixa_preco, fardo, orcamento, item_orcamento, historico_orcamento, resposta_orcamento, item_resposta_orcamento, pedido, item_pedido, operador (sem colunas sensíveis) e analise_credito (resultado). | pedido:inserir, pedido:atualizar (cancelamento), item_pedido:inserir, resposta_orcamento:inserir, item_resposta_orcamento:inserir e historico_orcamento:inserir (follow-up). Sem operações nomeadas. |
| Sistema 3 (painel) — proposto | Todas as tabelas, exceto documento_analise_credito e as colunas sensíveis (*:consultar, com agregacoes). | Nenhuma. |


### 12.8.6 Códigos de erro do proxy


| **Código** | **HTTP** | **Quando ocorre** |
|---|---|---|
| PAYLOAD_INVALIDO | 400 | Envelope ou payload fora do formato desta seção, tabela ou coluna inexistente, operador de filtro desconhecido. |
| TOKEN_INVALIDO | 401 | Token ausente, expirado, revogado ou requisição repetida (X-Timestamp fora da tolerância). |
| ESCOPO_NEGADO | 403 | O token não possui o escopo tabela:acao, rpc:<funcao> ou operacao:<identificador> exigido. |
| OPERACAO_DESCONHECIDA | 404 | O identificador da operação não consta no catálogo. |
| PEDIDO_JA_ASSUMIDO | 409 | pedido.assumir sobre pedido que não está mais SOLICITADO. |
| ESTOQUE_INSUFICIENTE | 409 | orcamento.emitir com saldo menor que a quantidade de algum item. |
| RESPOSTA_JA_PROCESSADA | 409 | resposta.processar sobre resposta que não está PENDENTE. |
| RISCO_ESTRUTURAL | 422 | A verificação de risco bloqueou a operação (por exemplo, dados.excluir sem filtro ou com mais de 50 linhas). |
| LIMITE_EXCEDIDO | 429 | Rate limiting: excesso de requisições do integrante. |


## 12.9 Pendências

- Modelagem de dados, diagramas e dicionário dos Sistemas 1 e 3, e a integração entre os sistemas na seção 13 — dependem dos respectivos grupos; este documento cobre somente o Sistema 2.
- Revisão dos escopos dos integrantes dos Sistemas 1 e 3 (seção 12.8.5) quando esses sistemas forem detalhados pelos respectivos grupos.
