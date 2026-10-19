# 4. Regras de Negócio


## 4.1 Faturamento, crédito e parcelamento


| **Regra** | **Condição** |
|---|---|
| **Primeira compra do cliente** | Pagamento 100% adiantado, independentemente do valor da compra. |
| **Faturamento mínimo** | R$ 500,00, válido a partir da segunda compra do cliente. É verificado na emissão do orçamento (sobre o total cotado) e novamente no aceite (sobre o total do orçamento aceito). |
| **Faturamento a prazo** | Compras a partir de R$ 500 podem ser faturadas por boleto mediante análise de crédito, com prazos de 10, 15, 20, 28 ou 30 dias corridos. |
| **Parcelamento** | Disponível apenas para compras a partir de R$ 1.500, sob análise de crédito. Até 6 parcelas, sem juros, com parcela mínima de R$ 250,00. Se o total aceito for inferior a R$ 1.500, a condição passa a boleto, no prazo desejado no pedido. |
| **Crédito reprovado** | Opção alternativa de pagamento: 50% do valor total adiantado e 50% restante após a entrega da mercadoria. |
| **Contagem dos prazos** | O prazo do boleto conta do aceite (ACEITO). A segunda metade do pagamento 50%/50% vence em até 3 dias corridos após a entrega. |
| **Base de avaliação** | Faturamento mínimo, frete, parcelamento e prazo são avaliados sobre o total do orçamento aceito, com imposto e sem frete (seção 4.6). |


### 4.1.1 Documentação exigida para análise de crédito

- Contrato social
- Balanço de lucro
- Comprovante de endereço
- Documento do proprietário do local
- Notas fiscais das últimas cinco compras
- Referências comerciais

### 4.1.2 Fluxo da análise de crédito


A documentação é enviada pelo cliente à equipe fiscal da empresa, que realiza a análise. O cliente é avisado do resultado em ambos os casos. Se aprovado, a negociação segue com boleto ou parcelamento conforme as regras vigentes. Se reprovado, o sistema oferece a opção de pagamento de 50% adiantado e 50% após a entrega (ver UC07, seção 5).


## 4.2 Frete


| **Regra** | **Condição** |
|---|---|
| **Frete CIF** | Aplicado para compras a partir de R$ 1.500 — a SupriMax assume o frete integralmente. |
| **Frete FOB** | Aplicado para compras abaixo de R$ 1.500. Nessa faixa, o processo pode seguir por duas vias: (a) a SupriMax cota o frete com uma transportadora e destaca esse valor no orçamento e na nota fiscal; ou (b) o cliente indica uma transportadora própria. O frete é sempre destacado e não é diluído no preço dos produtos; o imposto de 18% incide somente sobre os produtos. O faturamento mínimo é uma regra de faturamento independente do frete (seção 4.1). |


## 4.3 Imposto


A SupriMax é optante pelo Simples Nacional e não faz recolhimento de DIFAL. A alíquota de imposto é fixa em 18% sobre todos os produtos, sem variação por estado de destino.


### 4.3.1 Fórmula de cálculo

- Valor da linha = Quantidade × Preço unitário aplicado
- Valor do Imposto = Valor da linha × 18%, arredondado uma única vez (meio para cima, 2 casas)
- Valor Total do Item = Valor da linha + Valor do Imposto

### 4.3.2 Exemplo de aplicação


Produto no valor unitário de R$ 100,00, quantidade de 10 unidades:

- Valor da linha = 10 × R$ 100,00 = R$ 1.000,00
- Valor do imposto = R$ 1.000,00 × 18% = R$ 180,00
- Valor total do item = R$ 1.000,00 + R$ 180,00 = R$ 1.180,00

O arredondamento é feito uma única vez, sobre o valor da linha e não por unidade, coincidindo com a restrição do banco de dados (seção 13.4); o total do pedido é a soma dos totais das linhas.


No orçamento final, o valor do imposto aparece destacado por item, somando ao final o valor total da proposta já com impostos inclusos (seção 9).


## 4.4 Numeração, validade e disponibilidade


| **Regra** | **Condição** |
|---|---|
| **Numeração do orçamento** | Sequencial simples, única e crescente (00001, 00002, 00003…), sem vínculo com a data e sem limite superior: passados 99999 orçamentos, o número simplesmente ganha mais dígitos (100000, 100001…). Contador único do sistema, que não reinicia. O número é atribuído na emissão do orçamento; rascunhos não têm número. Uma nova versão recebe número novo. A data de geração e o CNPJ do cliente permanecem como campos próprios do orçamento, utilizados como filtros de busca. |
| **Validade do orçamento** | 30 dias corridos a partir da emissão — prazo em que o cliente pode fechar a compra pelo preço ofertado. Cada nova versão do orçamento recebe nova validade de 30 dias, contada da sua própria emissão. |
| **Disponibilidade de estoque** | O sistema só permite adicionar ao orçamento produtos com quantidade positiva em estoque à pronta entrega. Se a variação específica do produto estiver em falta (por exemplo, arroz 5 kg indisponível, restando apenas a versão de 1 kg), a inclusão é bloqueada, já que o preço pode variar entre variações. O saldo considerado é o disponível (estoque físico menos reservas vigentes). O rascunho não reserva estoque: a checagem é feita a cada inclusão e novamente na emissão, momento em que as reservas são criadas com status CONFIRMADA e passam a expirar junto com a validade do orçamento. Se a consulta ao estoque falhar ou expirar por tempo, a inclusão é bloqueada e o operador deve tentar novamente. Na emissão, se o saldo não cobrir a quantidade do orçamento, a emissão é bloqueada com a mensagem: “Estoque insuficiente para emitir: {produto}. Disponível: {X}; no orçamento: {Y}. Ajuste a quantidade ou remova o item.” Itens sem estoque disponível são encaminhados ao departamento de compras, fluxo externo a este módulo. |
| **Duração do rascunho** | Um orçamento em rascunho (ou pendente de crédito) que fique 30 dias sem edição é encerrado como EXPIRADO e, 30 dias depois, apagado do banco. A contagem parte da última edição. O rascunho não recebe número e não reserva estoque. Somente rascunhos são apagados; orçamentos emitidos nunca são. |


## 4.5 Continuidade de dados e governança


| **Regra** | **Condição** |
|---|---|
| **Continuidade de dados** | Nenhuma cotação em andamento pode ser perdida por falha de conexão do usuário. As alterações ficam em cache local no dispositivo até serem gravadas no banco de dados pelo backend, e a tela do operador passa a refletir os dados efetivamente persistidos. |
| **Governança do banco compartilhado** | Qualquer alteração na estrutura (schema) do banco de dados deve ser aprovada em conjunto pelos responsáveis pelos três sistemas, já que a base é única e compartilhada. |
| **Prazo de atualização de status** | O orçamento emitido expira (EXPIRADO) 30 dias após a emissão, coincidindo com a validade do preço. Quando faltarem sete dias para o vencimento, o sistema exibe um pop-up ao vendedor pedindo atualização: “manter em negociação” apenas registra um evento no histórico e não estende o prazo; “cliente recusou” grava a recusa pelo mesmo canal da resposta e o orçamento passa a RECUSADO. Para continuar a negociação após o vencimento, cria-se uma nova versão. |
| **Cláusula de consentimento LGPD** | A análise de crédito exige o envio de documentos com dados sensíveis do proprietário da empresa cliente, como contrato social e documento pessoal, o que demanda tratamento conforme a LGPD. A cláusula deve constar no cadastro de cliente e no rodapé do PDF de orçamento. |


## 4.6 Status e transições do pedido e do orçamento


Esta seção consolida os status usados no banco compartilhado, o fluxo do pedido ao aceite e as regras do fechamento por item.


**Status do pedido (tabela pedido)**


| **Status** | **Significado** |
|---|---|
| **SOLICITADO** | Registrado pelo vendedor no Sistema 1; aparece na lista de pedidos em aberto do Sistema 2. |
| **EM_ANALISE** | Um operador selecionou o pedido e está avaliando se é possível atendê-lo; enquanto isso, os demais operadores não o assumem. |
| **APROVADO** | O operador aprovou o pedido e emitiu o orçamento vinculado, que já está disponível ao vendedor. |
| **NEGADO** | O operador negou o pedido, com o motivo registrado; o vendedor vê o motivo no Sistema 1. |
| **CANCELADO** | O vendedor cancelou o pedido antes da análise. |


**Status do orçamento (tabela orcamento)**


| **Status** | **Significado** |
|---|---|
| **RASCUNHO** | Em montagem pelo operador; sem número e sem reserva de estoque; expira após 30 dias sem edição. |
| **PENDENTE_CREDITO** | Aguardando a análise de crédito pelo perfil FISCAL; emissão bloqueada; expira após 30 dias sem edição. |
| **ABERTO** | Emitido, com número, chave de segurança e reservas CONFIRMADA. Imutável. Cada item está marcado como aprovado ou não aprovado conforme as respostas do cliente; só passa a ACEITO com todos os itens aprovados. |
| **ALTERACAO_SOLICITADA** | O cliente pediu alteração; o operador deve criar uma nova versão (UC21). |
| **ACEITO** | Todos os itens aprovados. Estado final: mínimo e frete aplicados sobre o total aceito, estoque baixado. |
| **RECUSADO** | O cliente recusou o orçamento, inclusive por declínio no follow-up do vendedor. A justificativa é opcional. |
| **CANCELADO** | Cancelado pelo operador. A justificativa é opcional. |
| **SUBSTITUIDO** | Substituído por uma nova versão, com outro número, criada a partir de recusa, pedido de alteração ou itens não aprovados. |
| **EXPIRADO** | Encerrado por decurso de prazo: rascunho ou pendente de crédito com 30 dias sem edição, ou orçamento emitido 30 dias após a emissão sem aceite (campo motivo_expiracao). |


**Transições e quem as dispara**


| **De** | **Para** | **Disparo** |
|---|---|---|
| Pedido SOLICITADO | EM_ANALISE | Operador, ao selecionar o pedido na lista de pedidos em aberto. |
| Pedido EM_ANALISE | APROVADO | Sistema 2, na emissão do orçamento vinculado (UC19). |
| Pedido EM_ANALISE | NEGADO | Operador, ao negar o pedido com o motivo. |
| Pedido SOLICITADO | CANCELADO | Vendedor, no Sistema 1, antes da análise. |
| Orçamento RASCUNHO | PENDENTE_CREDITO | Sistema 2, ao calcular as condições comerciais (UC18). |
| PENDENTE_CREDITO | RASCUNHO | Perfil FISCAL, ao registrar o resultado da análise (UC07). |
| RASCUNHO | ABERTO | Operador, ao emitir o orçamento (UC19). |
| RASCUNHO ou PENDENTE_CREDITO | EXPIRADO | Job periódico, após 30 dias sem edição. |
| ABERTO | ACEITO | Sistema 2, ao processar uma resposta que deixa todos os itens aprovados (UC20). |
| ABERTO | RECUSADO | Sistema 2, ao processar a recusa registrada pelo vendedor (UC20), inclusive pelo pop-up de follow-up. |
| ABERTO | ALTERACAO_SOLICITADA | Sistema 2, ao processar o pedido de alteração registrado pelo vendedor (UC20). |
| ABERTO ou ALTERACAO_SOLICITADA | SUBSTITUIDO | Operador, ao emitir a nova versão (UC21). |
| ABERTO | EXPIRADO | Job periódico, 30 dias após a emissão sem aceite. |
| RASCUNHO, PENDENTE_CREDITO ou ABERTO | CANCELADO | Operador (UC06). |


**Regras do fechamento por item**

- A resposta do cliente é registrada pelo vendedor no Sistema 1, item a item: aprovado (com a quantidade aprovada, que pode ser menor que a cotada) ou não aprovado. O item cuja quantidade aprovada é zero fica NAO_APROVADO.
- A resposta é gravada como PENDENTE. O Sistema 2 a processa (UC20): recalcula o preço dos itens avulsos aprovados pela faixa da quantidade aprovada (o fardo mantém o preço fixo por pacote) e o imposto por linha (seção 4.3), e grava o valor consolidado. O Sistema 1 apenas exibe o último dado gravado; o valor consolidado é final.
- O orçamento permanece ABERTO enquanto houver item não aprovado. Cada nova resposta parte do estado da última resposta processada. Os itens aprovados só valem quando o orçamento chega a ACEITO; se ele expirar antes, nada é fechado e o estoque não baixa.
- Quando todos os itens estão aprovados, o Sistema 2 verifica o faturamento mínimo e o frete sobre o total aceito. Total abaixo do mínimo: o orçamento não é aceito e a resposta vai para tratamento do operador (motivo ABAIXO_DO_MINIMO).
- No ACEITO, as reservas dos itens aprovados passam a BAIXADA, o estoque físico é baixado (movimentação BAIXA) e as demais reservas, se houver, são liberadas.
- Recusa, pedido de alteração, itens não aprovados e total abaixo do mínimo entram na lista de respostas pendentes de tratamento do operador (UC21), que lê a justificativa e cria uma nova versão do orçamento.
- Na nova versão, todos os itens podem ser alterados ou removidos. A aprovação é herdada apenas pelos itens que o operador não alterar; alterar a quantidade ou o item o devolve a não aprovado. Remover um item não afeta os demais; o mínimo e o frete passam a valer sobre o que sobrou.
- A nova versão nunca nasce ACEITO: mesmo com todos os itens herdados como aprovados, o vendedor precisa registrar a confirmação do cliente sobre a nova versão (o total, o frete e a validade mudaram).
- Fechados no dia e faturamento usam o valor aceito; o valor total cotado é mantido para previsões e dashboards.
