# 1. Introdução


## 1.1 Objetivo do documento


Este documento descreve os requisitos, as regras de negócio, os casos de uso e os fluxos de interação do Sistema de Cotação Web da SupriMax (Sistema 2). Serve como referência técnica para as atividades de desenvolvimento, integração e teste do módulo, definindo o comportamento esperado do sistema e suas interfaces com os demais sistemas da solução.


Este documento também reúne a arquitetura técnica do frontend, do backend e do proxy (seções 10 a 12), o modelo de dados compartilhado entre os três sistemas (seção 13) e o módulo de cálculo de regras comerciais (seção 11.6), de modo que os requisitos, as regras e sua implementação fiquem em um único lugar.


## 1.2 Contexto de negócio


A SupriMax é uma distribuidora atacadista que atua exclusivamente no modelo B2B, vendendo para outras empresas — mercearias, restaurantes, lanchonetes, hotéis, padarias e similares — e não para o consumidor final. O Sistema de Cotação é um dos três módulos que compõem a solução completa da empresa.


## 1.3 Escopo do Sistema de Cotação


O Sistema 2 é responsável pelo processo de cotação. O operador da SupriMax realiza login no sistema, atende os pedidos registrados pelo vendedor no Sistema 1, consulta clientes cadastrados, monta orçamentos com produtos, marcas e preços, e o sistema aplica automaticamente as regras comerciais da empresa: faturamento, análise de crédito, parcelamento, frete e imposto.


Estão fora do escopo deste módulo o fluxo de reposição junto ao departamento de compras, a conversão do orçamento aceito em venda (faturamento, emissão de nota fiscal e boleto) e a construção das telas e indicadores do painel gerencial, cujo escopo pertence ao Sistema 3.


## 1.4 Arquitetura da solução


O ecossistema da SupriMax é composto por três aplicações que se comunicam entre si e, em conjunto, formam uma única solução integrada:

- Sistema 1 — Força de Vendas Mobile.
- Sistema 2 — Sistema de Cotação Web (objeto deste documento).
- Sistema 3 — Painel Gerencial Web, primeira tela vista pelo gestor ao fazer login, com indicadores de BI, controle de vendas, gráficos de lucro e funcionalidades de gestão como controle de estoque.

A arquitetura adota um banco de dados único, compartilhado pelos três sistemas. Clientes, fornecedores, produtos, pedidos, orçamentos e demais entidades cadastradas em um sistema ficam imediatamente disponíveis para os demais, sem necessidade de sincronização ou replicação de dados entre bases separadas. A troca de informações entre os sistemas acontece por esse banco: um sistema grava um registro (por exemplo, um pedido) e o outro o lê e o processa.


As regras comerciais — cálculos de faturamento, crédito, parcelamento, frete e imposto — são centralizadas em um módulo de cálculo, interno ao backend do Sistema 2, que é o único responsável por aplicá-las (montagem do orçamento e consolidação da resposta do cliente). O Sistema 1 e o Sistema 3 não implementam essas regras: apenas gravam e leem dados no banco compartilhado. Essa centralização evita que cada sistema implemente sua própria lógica de forma duplicada e potencialmente inconsistente.


O acesso ao banco de dados é sempre intermediado por um proxy, que valida e trata as requisições dos três sistemas. O proxy é uma barreira transparente da solução: existe e deve ser aplicado em toda comunicação, mas, para quem o utiliza, funciona como um backend adicional, que autentica, valida e executa as operações sobre o banco. O frontend do Sistema 2 conversa apenas com o backend do Sistema 2; o Sistema 1 possui backend próprio; os dois backends leem e gravam no banco exclusivamente através do proxy. O proxy não se comunica com os frontends.


## 1.5 Integração entre o Sistema 1 e o Sistema 2


O vendedor possui uma página própria no Sistema 1 (mobile) para lançar a venda. A partir dela, abre um pedido de orçamento no banco de dados compartilhado (tabelas pedido e item_pedido), informando o cliente, os produtos desejados e toda a configuração do pedido (quantidades, fardo ou avulso, endereço de entrega, número da solicitação de compra, contato e demais condições). O Sistema 1 não chama o Sistema 2 diretamente: grava o pedido pelo seu backend próprio, através do proxy. O operador do Sistema 2 seleciona o pedido na lista de pedidos em aberto, analisa se é possível atendê-lo e, sendo possível, o aprova, monta o orçamento e o emite, deixando-o disponível ao vendedor; não sendo possível, nega o pedido informando o motivo. O Sistema 1 é responsável por informar ao vendedor, a partir do status registrado no banco, que o orçamento está pronto ou que o pedido foi negado. A partir da emissão, o vendedor registra no Sistema 1 a resposta do cliente, item a item (aprovado ou não aprovado, com a quantidade aprovada) e a justificativa, quando houver. O Sistema 2 processa a resposta, recalcula os itens aprovados e grava o valor consolidado no banco; o Sistema 1 apenas exibe o último dado gravado. O orçamento só é aceito (ACEITO) quando todos os seus itens estão aprovados. Recusas, pedidos de alteração e itens não aprovados são tratados pelo operador, que reestrutura o orçamento em uma nova versão para o cliente reavaliar. Orçamentos recusados, cancelados, substituídos ou expirados são encerrados, de modo a não permanecerem em aberto no sistema.
