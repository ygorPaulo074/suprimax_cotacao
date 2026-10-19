# 2. Requisitos Funcionais


Os requisitos funcionais descrevem o que o sistema deve fazer.


| **ID** | **Descrição** |
|---|---|
| **RF01** | O sistema deve permitir login individual por usuário, com os perfis VENDEDOR (Sistema 1), OPERADOR, OPERADOR_CHEFE, FISCAL, FINANCEIRO e GESTOR. |
| **RF02** | O sistema deve permitir cadastro de produtos com múltiplas marcas e tamanhos/embalagens. |
| **RF03** | O sistema deve permitir cadastro de clientes, com contato, endereço, indicação de matriz/filial e locais de entrega. |
| **RF04** | O sistema deve permitir busca de cliente por CNPJ, retornando dados cadastrais, orçamentos em aberto e histórico de compras. |
| **RF05** | O sistema deve permitir geração de orçamentos/cotações com produtos, quantidades e preços por cliente. |
| **RF06** | O sistema deve aplicar automaticamente as regras de faturamento mínimo, análise de crédito, parcelamento, frete e cálculo de imposto de 18% (seção 4). |
| **RF07** | O sistema deve manter histórico de cotações e compras por cliente. |
| **RF08** | O sistema deve utilizar login unificado com o Sistema 1 e o Sistema 3, validando permissões de acordo com o tipo de conta do usuário. |
| **RF09** | A busca de produtos deve trazer código interno e classificação fiscal (NCM), quando aplicável ao produto. |
| **RF10** | A cotação deve permitir vincular um número de solicitação de compra do cliente e um contato específico. |
| **RF11** | O sistema deve permitir anexar arquivos à cotação, como descritivos técnicos do produto e materiais de apoio/marketing. |
| **RF12** | O sistema deve gerar um documento de orçamento em PDF com layout padronizado, incluindo numeração sequencial própria, única e crescente (00001, 00002…), com no mínimo cinco dígitos e sem limite superior, sem vínculo com a data. O número é atribuído na emissão do orçamento (seção 9). |
| **RF13** | O Sistema 1 deve registrar pedidos de orçamento no banco de dados compartilhado (tabelas pedido e item_pedido), com o cliente, os produtos desejados e toda a configuração do pedido. O Sistema 2 deve exibir ao operador a lista de pedidos em aberto, permitir que ele analise o pedido e o aprove (montando e emitindo o orçamento vinculado) ou o negue com o motivo, e atualizar o status do pedido. A exibição do orçamento pronto ao vendedor é responsabilidade do Sistema 1. |
| **RF14** | O sistema deve permitir que o vendedor registre no Sistema 1 a resposta do cliente ao orçamento emitido: aprovação ou não aprovação item a item, recusa ou pedido de alteração. A resposta é gravada como PENDENTE e processada pelo Sistema 2. A justificativa de recusa ou cancelamento é opcional: o sistema aceita o campo vazio. |
| **RF15** | O sistema deve permitir o fechamento por item: o cliente aprova ou não aprova cada item, podendo aprovar quantidade menor que a cotada. O orçamento permanece ABERTO com os itens marcados e só passa a ACEITO quando todos os itens estão aprovados. O preço dos itens avulsos é recalculado pela faixa da quantidade aprovada, e o faturamento mínimo, o frete e a baixa de estoque são aplicados no ACEITO (seção 4.6). |
| **RF16** | O sistema deve encerrar como RECUSADO o orçamento recusado pelo cliente (inclusive no follow-up do vendedor). Deve expirar (EXPIRADO) o rascunho e o orçamento pendente de crédito após 30 dias sem edição, apagando o rascunho expirado 30 dias depois, e o orçamento emitido 30 dias após a emissão sem aceite. Deve exibir um pop-up ao vendedor quando faltarem sete dias para o vencimento, identificando o orçamento e solicitando atualização (manter em negociação ou cliente recusou). |
| **RF17** | O sistema deve disponibilizar dados agregados para consumo do Sistema 3 (BI/dashboard): quantidade de orçamentos em aberto, orçamentos fechados (ACEITO) no dia, orçamentos recusados no dia e faturamento do dia e do mês. Os fechados e o faturamento consideram o valor aceito; o valor total cotado é mantido para previsões e dashboards. |
| **RF18** | O sistema só deve permitir adicionar ao orçamento produtos, por variação específica de tamanho/embalagem, com quantidade positiva em estoque à pronta entrega; variações indisponíveis não podem ser adicionadas, ainda que outra variação do mesmo produto esteja disponível. O rascunho não reserva estoque. Se a consulta ao estoque falhar ou expirar por tempo, a inclusão é bloqueada e o operador deve tentar novamente. |
| **RF19** | No momento da entrada de mercadoria, o sistema deve validar que a quantidade cadastrada pelo operador corresponde exatamente à quantidade comprada junto ao fornecedor, registrada na cotação de compra, impedindo o salvamento em caso de divergência; a trava só pode ser liberada por um operador chefe, mediante login e senha próprios (perfil de exceção). |
| **RF20** | O sistema deve exibir e registrar a cláusula de consentimento LGPD tanto no cadastro de cliente quanto no rodapé do PDF de orçamento. |
| **RF21** | O sistema deve permitir que o operador crie uma nova versão do orçamento a partir de recusa, pedido de alteração ou itens não aprovados. A versão tem número novo, validade de 30 novos dias e vínculo com o orçamento original, que passa a SUBSTITUIDO. O orçamento emitido é imutável. Todos os itens da nova versão podem ser alterados ou removidos; a aprovação dos itens é herdada apenas para os itens não alterados, e a nova versão só chega a ACEITO com a confirmação do cliente registrada pelo vendedor. |
| **RF22** | O sistema deve permitir o cadastro mínimo de fornecedores (quem fornece produtos à SupriMax), utilizado no registro de entrada de mercadoria. |
| **RF23** | O rascunho de orçamento não reserva estoque e expira após 30 dias sem edição (EXPIRADO), sendo apagado 30 dias depois. As reservas são criadas, com status CONFIRMADA, quando o orçamento é emitido com sucesso e são baixadas do estoque físico quando o orçamento chega a ACEITO. |
| **RF24** | O sistema deve permitir que o operador chefe cadastre, altere e inative usuários e perfis (UC25); a inativação de vendedor com clientes na carteira exige indicar o novo vendedor responsável. |
| **RF25** | O sistema deve permitir que o perfil FINANCEIRO registre dívidas de clientes e suas renegociações (UC23). |
| **RF26** | O sistema deve permitir que o operador chefe ajuste o estoque físico, com motivo obrigatório, e registrar toda movimentação de estoque (entrada, baixa, ajuste e estorno) em histórico (UC24). |
| **RF27** | O sistema deve exibir ao operador a lista de respostas do cliente que exigem tratamento (recusa, pedido de alteração, itens não aprovados ou total abaixo do mínimo), com a justificativa e a situação dos itens, para que ele reestruture o orçamento em nova versão (UC21). |
