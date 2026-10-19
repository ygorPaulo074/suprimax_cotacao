# 11. Backend do Sistema 2


Esta seção documenta a arquitetura técnica do backend do Sistema 2, detalhando as camadas, comunicações, regras de negócio e componentes que implementam os requisitos e regras descritos nas seções 3 e 4 deste documento.


## 11.1 Camadas do sistema


O backend do Sistema 2 é estruturado em três camadas lógicas:


| **Camada** | **Responsabilidade** |
|---|---|
| **Apresentação** | Não faz parte do backend; é o consumidor direto de sua API — o frontend React (Sistema 2). O Sistema 1 (mobile) possui backend próprio e não consome a API do Sistema 2: a troca de informações entre os dois acontece pelo banco compartilhado (pedidos e respostas), sempre através do proxy. Esta camada só se comunica com o backend, nunca diretamente com o proxy ou o banco (RNF05). |
| **Negócio (Node.js/TypeScript)** | Concentra a lógica de aplicação e as regras comerciais (seção 4 e 11.2). Subdivide-se em: API REST/HTTP (endpoints consumidos pelo frontend e pelo Sistema 1); chamada interna às funções do módulo de cálculo (seção 11.6, para faturamento, crédito, parcelamento, frete e imposto); e serviços de domínio (autenticação/autorização, gestão de estoque e reservas, geração de PDF e chave de segurança, jobs agendados). |
| **Dados** | O backend nunca acessa o banco diretamente. Toda leitura e escrita passa pelo proxy de comunicação (seção 12), que gerencia, valida e serializa as requisições concorrentes vindas dos três sistemas. |


## 11.2 Comunicação entre camadas


| **Comunicação** | **Protocolo / observações** |
|---|---|
| **Frontend (React) ↔ Backend** | REST/JSON, autenticação via token de sessão; endpoints de CRUD, cotação e histórico. |
| **Sistema 1 (mobile) ↔ Banco compartilhado ↔ Backend (Sistema 2)** | Sem chamada direta entre os sistemas. O backend próprio do Sistema 1 grava pedidos e respostas pendentes no banco através do proxy (credencial de serviço em variável de ambiente); o backend do Sistema 2 lê esses registros pelo proxy e grava orçamentos, status e respostas consolidadas, que o Sistema 1 lê (RF13). |
| **Backend ↔ Módulo de cálculo comercial** | Chamada interna de função, dentro do próprio processo do backend (seção 3.1); centraliza faturamento, crédito, parcelamento, frete e imposto. |
| **Backend ↔ Proxy de comunicação** | REST/JSON, com autenticação por variável de ambiente (seção 12.3) — único canal de leitura/escrita na base; nenhum componente acessa o banco diretamente (RNF05). |
| **Backend (Sistema 2) → Sistema 3** | Exposição de dados agregados (BI): o Sistema 2 apenas disponibiliza os dados; consumo e renderização do dashboard pertencem ao Sistema 3 (RF17). |


## 11.3 Regras de negócio detalhadas pelo backend


As regras abaixo complementam a seção 4 com o nível de detalhe técnico necessário para implementação.


| **Regra (seção 4)** | **Detalhe técnico acrescentado pelo backend** |
|---|---|
| **Faturamento a prazo (4.1)** | Prazos válidos restritos a 10, 15, 20, 28 ou 30 dias corridos — qualquer outro prazo deve ser rejeitado pelo backend. |
| **Crédito (4.1)** | A análise de crédito é feita por compra (aprovada ou reprovada, conforme os critérios da seção 4.1), sem limite numérico acumulado de pedidos em aberto. RN06: cliente com dívida em aberto não tem nova compra liberada automaticamente; a liberação exige renegociação com pagamento de no mínimo 50% do valor devido, seguida de nova análise de crédito normal; sem renegociação, não há venda; após 60 dias de atraso, a dívida é protestada. |
| **Frete (4.2)** | Cliente com frete CIF contratual: o backend ignora a regra de valor-limite e aplica CIF diretamente, independentemente do total do pedido. |
| **Disponibilidade de estoque (4.4)** | RN14: o saldo considerado é sempre o disponível (saldo físico − reservas vigentes), nunca o físico bruto. RN15: o rascunho não reserva estoque; as reservas são criadas na emissão, com status CONFIRMADA (uma por item), e expiram junto com a validade do orçamento. A inclusão de item é bloqueada quando o estoque está zerado ou quando a consulta falha por timeout (nova tentativa pelo operador). |
| **Validade do orçamento (4.4)** | RN24: após o vencimento dos 30 dias, os preços devem ser revalidados antes de qualquer conversão em pedido. |
| **Emissão do orçamento (UC19)** | RN21/RN22/RN23: ao emitir, o backend gera uma chave/hash antifraude a partir do conteúdo do orçamento — única, irrepetível e usada para validar a autenticidade do documento; o orçamento emitido é imutável, e qualquer alteração exige nova versão. |
| **Login (RF01/RF08)** | Bloqueio temporário de conta após três tentativas de login inválidas (conforme UC13, seção 5.15); acesso negado a usuários inativos/demitidos; recuperação de senha via link enviado ao e-mail corporativo. |
| **Rascunho (4.4)** | Expira após 30 dias sem edição (data_ultima_edicao): job periódico muda o status para EXPIRADO e, 30 dias depois, apaga o rascunho. Vale também para PENDENTE_CREDITO. O rascunho não recebe número e não reserva estoque. |
| **Fechamento por item (4.6)** | A resposta do Sistema 1 é gravada como PENDENTE. O backend recalcula o preço avulso pela faixa da quantidade aprovada e o imposto por linha. Enquanto houver item não aprovado, o orçamento permanece ABERTO. Com todos os itens aprovados, verifica o mínimo e o frete sobre o total aceito e, atendidas as regras, muda para ACEITO e baixa o estoque. Abaixo do mínimo, a resposta segue para tratamento do operador. |
| **Versão do orçamento (UC21)** | O orçamento emitido é imutável (RN22). Recusa, pedido de alteração ou itens não aprovados geram, após tratamento do operador, um novo orçamento com número novo e validade de 30 novos dias, vinculado ao original (id_orcamento_origem); o original passa a SUBSTITUIDO. Os itens não alterados herdam a marca de aprovado (aprovacao_herdada), mas a nova versão só chega a ACEITO com a confirmação do cliente. |
| **Vencimento do orçamento (4.5)** | O orçamento emitido expira 30 dias após a emissão (job periódico). O pop-up de follow-up é calculado por consulta: orçamentos ABERTO com vencimento em até sete dias. |
| **Movimentação de estoque (UC24)** | Toda variação do estoque físico (entrada, baixa no ACEITO, ajuste, estorno) gera um registro em movimentacao_estoque; o saldo físico é atualizado a partir dele. |


## 11.4 Componentes principais do backend

- Módulo de Autenticação/Autorização — login unificado, geração e validação de sessão/token, controle de permissões por perfil (vendedor, operador, operador chefe, fiscal, financeiro e gestor).
- Módulo de Cadastro — CRUD de produtos (com variações), de clientes (incluindo tratamento de consentimento LGPD) e de fornecedores (cadastro mínimo).
- Módulo de Cotação — orquestra o fluxo completo de geração de orçamento: seleção de produtos, cálculo de linha, aplicação de condições comerciais, emissão do documento final, criação de novas versões e consolidação da resposta do cliente.
- Módulo de Estoque — consulta de saldo disponível, reserva vinculada ao orçamento (criada na emissão), expiração de reserva por validade, baixa no aceite e histórico de movimentações (entrada, baixa, ajuste e estorno).
- Módulo de Geração de Documentos — renderização do PDF de orçamento, numeração sequencial atômica, geração de chave/hash antifraude.
- Módulo de Integração com Sistema 1 — leitura dos pedidos registrados pelo Sistema 1 no banco (lista de pedidos em aberto, análise, aprovação e negativa), vinculação do orçamento ao pedido e processamento das respostas pendentes (recálculo, aceite e encaminhamento ao operador).
- Módulo de Agregação para BI — cálculo e exposição dos indicadores consumidos pelo Sistema 3.
- Módulo de Jobs Agendados — expiração de rascunhos e de orçamentos pendentes de crédito (30 dias sem edição) e exclusão do rascunho expirado 30 dias depois; expiração de orçamentos emitidos (30 dias após a emissão) e de reservas; marcação de protesto. O pop-up de vencimento é calculado por consulta, sem job.
- Camada de Acesso a Dados (cliente do proxy) — abstrai toda comunicação com o proxy de comunicação (seção 12), garantindo que nenhum outro módulo acesse a base diretamente.

## 11.5 Considerações de confiabilidade

- Persistência resiliente: cache local no cliente até confirmação de gravação pelo backend via proxy, com atualização da tela somente após a leitura confirmada do banco (RNF06, já registrado na seção 3.2).
- Alterações no schema do banco compartilhado exigem aprovação conjunta dos responsáveis pelos três sistemas (seção 3.2).
- Falhas em serviços externos: o frete FOB ainda sem cotação da transportadora é sinalizado como provisório e não bloqueia o fluxo; falha ou timeout na consulta de estoque bloqueia a inclusão do item e pede nova tentativa ao operador.

## 11.6 Módulo de Cálculo


### 11.6.1 Visão geral


O Módulo de Cálculo é um componente centralizado, implementado em TypeScript (Node.js), responsável por aplicar as regras comerciais da SupriMax (faturamento, análise de crédito, parcelamento, frete, imposto, numeração e validade de orçamento, disponibilidade de estoque).


Ele concentra essas regras em um único lugar, para que sejam aplicadas de forma consistente sempre que um cálculo comercial precisar ser realizado, evitando que a mesma lógica seja implementada de formas diferentes em pontos distintos do sistema.


O módulo é interno ao backend e é consumido por importação direta no código, por meio de chamada de função.


### 11.6.2 Convenções gerais


**Premissa de projeto:** as funções do módulo são puras — não acessam banco de dados, relógio do sistema nem rede. Tudo o que depende de dado externo ou de decisão humana entra como parâmetro:

- **Crédito:** a análise é feita pela equipe fiscal e gravada em `analise_credito`; o módulo recebe o resultado (`APROVADO`, `REPROVADO` ou pendente) e não decide crédito.
- **Estoque e data:** o saldo disponível (físico − reservas vigentes (CONFIRMADA)) e a data de emissão são recebidos como parâmetro.
- **Frete FOB:** o valor cotado com a transportadora é informado pelo operador.
- **Número do orçamento:** gerado pela sequence do banco; o módulo apenas formata (mínimo de cinco dígitos, sem limite superior) (seção 11.6.3.5).

Assim, a mesma entrada sempre produz o mesmo resultado, e as funções podem ser testadas por tabela de casos (Jest), sem simular banco de dados.


#### 11.6.2.1 Formato de dados


As convenções abaixo valem para todas as funções do módulo.


| **Item** | **Convenção** |
|---|---|
| Dinheiro | Inteiro em centavos (`number` inteiro, ≥ 0), em BRL. A conversão para/de reais ocorre somente nas bordas do módulo: na camada de acesso a dados (de/para `DECIMAL(12,2)`) e na apresentação (formato R$ 0.000,00). |
| Arredondamento | Meio para cima, 2 casas decimais, aplicado uma única vez por linha de item, sobre o valor da linha (quantidade × preço unitário aplicado). É o mesmo critério do `ROUND` usado no CHECK do banco (seção 13.4). |
| Datas | String ISO `'AAAA-MM-DD'`, sem hora nem fuso; aritmética de datas em UTC, para que a data não “ande um dia” por causa do fuso. |
| Identificadores | `number`, como o INTEGER do banco. O número do orçamento é um `number` inteiro maior ou igual a 1, sem limite superior; o formato '00001' (mínimo de cinco dígitos) existe apenas na exibição. |
| Enumerações | Unions de string com os mesmos valores do dicionário de dados: `'FARDO' \| 'AVULSO'`, `'CIF' \| 'FOB'`, `'APROVADO' \| 'REPROVADO'`. |
| Valores de regra | Constantes em um único arquivo, `regras.ts`: alíquota (18%), faturamento mínimo e limite de faturamento a prazo (50000), limite de CIF e parcelamento (150000), prazos permitidos (10, 15, 20, 28 e 30 dias), validade (30 dias), percentual de adiantamento (50%), máximo de 6 parcelas e parcela mínima de R$ 250,00 (25000 centavos). As funções não repetem esses números no código. |
| Assinatura | Cada função recebe um objeto de entrada e devolve um objeto de saída, com campos em camelCase derivados do dicionário de dados (`precoUnitarioAplicado` ↔ `preco_unitario_aplicado`). Tipos e interfaces ficam em `types.ts`. |


**Tipos básicos**


```ts
// types.ts
export type Centavos = number;   // inteiro >= 0
export type DataISO = string;    // 'AAAA-MM-DD'
export type ResultadoCredito = 'APROVADO' | 'REPROVADO' | null;
                                 // null = análise pendente
export type Granularidade = 'FARDO' | 'AVULSO';
export type CondicaoPagamento = 'ADIANTADO_100' | 'BOLETO' | 'PARCELADO' | 'ADIANTADO_50_50';
export type OrigemTransportadora = 'SUPRIMAX' | 'CLIENTE';
```


**Imposto por linha**


O imposto é 18% do valor da linha (quantidade × preço unitário aplicado), arredondado ao centavo uma única vez; o total do pedido é a soma dos totais das linhas. É o mesmo cálculo do CHECK do banco (`valor_imposto = ROUND(base × 0,18; 2)`).


```ts
// imposto.ts  (CalculoError: ver seção 11.6.2.3)
import { ALIQUOTA_IMPOSTO_PERCENTUAL } from './regras';  // 18
import type { Centavos } from './types';
 
export function calcularImpostoItem({ quantidade, precoUnitarioAplicado }: {
  quantidade: number; precoUnitarioAplicado: Centavos;
}) {
  if (!Number.isInteger(quantidade) || quantidade <= 0)
    throw new CalculoError('CALC_ENTRADA_INVALIDA', 'quantidade',
      `inteiro > 0 esperado; recebido ${quantidade}`);
  if (!Number.isInteger(precoUnitarioAplicado) || precoUnitarioAplicado < 0)
    throw new CalculoError('CALC_ENTRADA_INVALIDA', 'precoUnitarioAplicado',
      `centavos inteiros >= 0 esperado; recebido ${precoUnitarioAplicado}`);
 
  const valorLinha = quantidade * precoUnitarioAplicado;
  // meio para cima, uma única vez, em centavos inteiros
  const imposto = Math.floor(
    (valorLinha * ALIQUOTA_IMPOSTO_PERCENTUAL + 50) / 100,
  );
  return { valorLinha, imposto, totalItem: valorLinha + imposto };
}
 
// calcularImpostoItem({ quantidade: 10, precoUnitarioAplicado: 10000 })   // 10 un. x R$ 100,00
//   -> { valorLinha: 100000, imposto: 18000, totalItem: 118000 }
// calcularImpostoItem({ quantidade: 10, precoUnitarioAplicado: 1055 })    // 10 un. x R$ 10,55
//   -> { valorLinha: 10550, imposto: 1899, totalItem: 12449 }
```


A assinatura definitiva desta função está na seção 11.6.3.3, e as demais funções do módulo estão especificadas na seção 11.6.3. O detalhamento do cálculo, com exemplos e casos de arredondamento, também está na seção 11.6.3.3.


**Base de comparação e limites comerciais**


Os limites são comparados com a soma dos valores totais dos itens (já com imposto), sem o frete. O frete depende da faixa de valor, e incluí-lo criaria dependência circular.


| **Regra** | **Condição** | **Limite (centavos)** |
|---|---|---|
| Faturamento mínimo (a partir da 2ª compra) | valor ≥ R$ 500,00 | 50000 |
| Faturamento a prazo (boleto, sob análise de crédito) | valor ≥ R$ 500,00 | 50000 |
| Parcelamento (sob análise de crédito) | valor ≥ R$ 1.500,00 | 150000 |
| Frete CIF | valor ≥ R$ 1.500,00 | 150000 |
| Frete FOB | valor < R$ 1.500,00 | 150000 |


Os limites são inclusivos (“a partir de”), de modo que nenhum valor fica sem regra: um pedido de exatamente R$ 500,00 atinge o faturamento mínimo e habilita o faturamento a prazo; um pedido de exatamente R$ 1.500,00 é CIF e pode ser parcelado. Os testes de borda cobrem 49999, 50000, 149999 e 150000 centavos.


#### 11.6.2.2 Versionamento do módulo


O módulo não é publicado como pacote: fica no monorepo (`/backend/services/calculo/`) e é importado diretamente pelo backend. Por isso, a versão efetiva é o commit. Mesmo assim, as mudanças de regra precisam ser rastreáveis:

- **Constante de versão:** o `index.ts` do módulo exporta `VERSAO_REGRAS`, em semver (`MAJOR.MINOR.PATCH`), a partir de `1.0.0`.
- **Regra de incremento:** MAJOR quando muda o resultado para a mesma entrada (alíquota, faixas de valor, prazos) ou quando muda uma assinatura; MINOR para função nova ou parâmetro opcional; PATCH para correção que não altera resultado.
- **Registro no CHANGELOG do backend:** o módulo não tem changelog próprio. Toda alteração é registrada em `/backend/CHANGELOG.md`, com a observação “módulo de cálculo” e o valor de `VERSAO_REGRAS` correspondente. O CHANGELOG é obrigatório para todos os serviços (seção 3.3.5).
- **PR próprio para mudança de regra comercial:** a PR referencia o caso de uso (seção 3.3.1), atualiza os testes Jest (tabela de casos, por exemplo 10 × R$ 100,00 = R$ 1.180,00) e as descrições das funções e das regras na seção 11.6.3, tudo na mesma PR.
- **Efeito sobre dados já gravados:** o preço, o imposto e o total do item ficam congelados na inclusão (`preco_unitario_aplicado`) e o orçamento emitido é imutável. Uma mudança de regra só atinge cotações novas ou recalculadas (UC05, RN24).

#### 11.6.2.3 Tratamento de erros e exceções


O módulo distingue duas situações, tratadas de forma diferente:


**Resultado de regra (não é erro)**


Mínimo não atingido, crédito reprovado e estoque indisponível são desfechos previstos do negócio e voltam como dado, no objeto de retorno (por exemplo, `{ ok: false, motivo: 'ABAIXO_DO_MINIMO' }`). Cabe ao backend decidir se isso vira mensagem na tela (UC18, E1 e E2) ou `AppError` (`CreditoReprovado`, `EstoqueIndisponivel`; seção 12.6).


**Frete provisório:** frete FOB ainda sem valor cotado com a transportadora não gera exceção. O retorno traz `provisorio: true`, e o backend sinaliza a provisoriedade no orçamento (UC18, E3).


**Entrada inválida (falha de quem chama)**


Campo ausente, tipo errado, valor negativo ou não inteiro em centavos, quantidade menor ou igual a zero e prazo fora da lista permitida indicam falha do chamador, não regra de negócio. O módulo lança `CalculoError` (`extends Error`) com `codigo`, `campo` e `detalhe`; nunca devolve `NaN` nem corrige o valor em silêncio. O backend traduz o erro para `VALIDATION_ERROR` (seção 12.6), sem expor `campo` e `detalhe` ao cliente.


```ts
class CalculoError extends Error {
  codigo: string;   // um dos códigos da tabela abaixo
  campo: string;    // campo de entrada que causou o erro
  detalhe: string;  // explicação para log e depuração
}
```


| **Código** | **Quando ocorre e causa provável** | **Exemplo (ilustrativo)** |
|---|---|---|
| CALC_ENTRADA_INVALIDA | Campo ausente, tipo errado, valor negativo, valor monetário não inteiro (fora de centavos) ou quantidade menor ou igual a zero. Causa provável: bug no chamador ou conversão de reais para centavos feita no lugar errado. | { codigo: 'CALC_ENTRADA_INVALIDA', campo: 'quantidade', detalhe: 'inteiro > 0 esperado; recebido 0' } |
| CALC_PRAZO_INVALIDO | Prazo de faturamento fora de 10, 15, 20, 28 ou 30 dias corridos (seção 11.3). | { codigo: 'CALC_PRAZO_INVALIDO', campo: 'prazoDias', detalhe: 'prazo 25 não permitido; permitidos: 10, 15, 20, 28, 30' } |
| CALC_PARCELAS_INVALIDAS | Número de parcelas fora de 2 a 6 (seção 11.3). Causa provável: valor digitado sem validação no chamador. | { codigo: 'CALC_PARCELAS_INVALIDAS', campo: 'numeroParcelas', detalhe: 'parcelas 8 não permitido; permitido: 2 a 6' } |
| CALC_DATA_INVALIDA | Data fora do formato 'AAAA-MM-DD' ou inexistente no calendário. | { codigo: 'CALC_DATA_INVALIDA', campo: 'dataEmissao', detalhe: "'2026-02-30' não é uma data válida" } |
| CALC_NUMERO_INVALIDO | Número do orçamento que não seja inteiro maior ou igual a 1. | { codigo: 'CALC_NUMERO_INVALIDO', campo: 'numero', detalhe: 'inteiro >= 1 esperado; recebido 0' } |
| CALC_FAIXA_NAO_ENCONTRADA | Item AVULSO cuja quantidade aprovada não atinge a quantidade mínima de nenhuma faixa de preço informada. | { codigo: 'CALC_FAIXA_NAO_ENCONTRADA', campo: 'faixas', detalhe: 'nenhuma faixa atende a quantidade 2 do item 41' } |
| CALC_GRANULARIDADE_INVALIDA | Dados incompatíveis com a granularidade: item FARDO sem precoFardo (ou sem unidadesPorFardo) ou item AVULSO sem faixas. | { codigo: 'CALC_GRANULARIDADE_INVALIDA', campo: 'precoFardo', detalhe: 'obrigatório para granularidade FARDO' } |


A lista cresce sob demanda, no mesmo padrão do catálogo de mensagens da seção 12.6: todo código novo entra na tabela acima, com descrição e exemplo, antes de ir para produção. Os campos dos exemplos correspondem às assinaturas da seção 11.6.3.


### 11.6.3 Funções de cálculo


Funções organizadas por domínio de regra de negócio. Cada função recebe um objeto de entrada e devolve um objeto de saída, em centavos e com datas ISO (convenções na seção 11.6.2). Os resultados de regra voltam como { ok: false, motivo }, e a entrada inválida lança CalculoError (seção 11.6.2.3). Os tipos Centavos, DataISO, ResultadoCredito, Granularidade, CondicaoPagamento e OrigemTransportadora estão em types.ts.


#### 11.6.3.1 Faturamento e crédito


**Validar condição de faturamento**


| **Nome da Função** | validarCondicaoFaturamento |
|---|---|
| **Descrição** | Verifica qual condição de pagamento se aplica a uma compra: se é a primeira compra do cliente, se atinge o faturamento mínimo, e se pode ser faturada a prazo ou parcelada. |
| **Fórmula/Regra aplicada** | Primeira compra do cliente → 100% adiantado, independentemente do valor. Compras seguintes: faturamento mínimo de R$ 500; a prazo (boleto) mediante análise de crédito para compras a partir de R$ 500, com prazos de 10, 15, 20, 28 ou 30 dias corridos (qualquer outro prazo é rejeitado); parcelamento apenas para compras a partir de R$ 1.500, também sob análise de crédito, em até 6 parcelas sem juros, com parcela mínima de R$ 250,00. |
| **Parâmetros de entrada** | { <br> valorTotalItens: Centavos;   // soma dos totais das linhas, com imposto e sem frete <br> primeiraCompra: boolean;   // true se o cliente não tem compra fechada (ACEITO) anterior <br> resultadoCredito: ResultadoCredito;   // null = análise pendente <br> prazoDias?: number;   // 10, 15, 20, 28 ou 30 (boleto) <br> numeroParcelas?: number;   // 2 a 6 (parcelamento) <br> } |
| **Retorno** | { ok: true; condicao: CondicaoPagamento; prazoDias: number \| null; numeroParcelas: number \| null; valorParcela: Centavos \| null; exigeAnaliseCredito: boolean } <br> ou { ok: false; motivo: 'ABAIXO_DO_MINIMO' \| 'CREDITO_PENDENTE' \| 'CREDITO_REPROVADO' \| 'PARCELAMENTO_INDISPONIVEL' \| 'PARCELA_ABAIXO_DO_MINIMO' } <br> condicao: primeira compra → 'ADIANTADO_100'; com numeroParcelas ≥ 2 → 'PARCELADO'; caso contrário → 'BOLETO'. valorParcela = divisão inteira do total pelo número de parcelas (o resto vai para a última). CREDITO_REPROVADO indica ao chamador que deve usar calcularCondicaoCreditoReprovado. <br> Erros (CalculoError): CALC_ENTRADA_INVALIDA, CALC_PRAZO_INVALIDO, CALC_PARCELAS_INVALIDAS. |


**Calcular condição em caso de crédito reprovado**


| **Nome da Função** | calcularCondicaoCreditoReprovado |
|---|---|
| **Descrição** | Define a condição de pagamento alternativa quando a análise de crédito do cliente é reprovada. |
| **Fórmula/Regra aplicada** | 50% do valor total adiantado + 50% restante após a entrega da mercadoria. |
| **Parâmetros de entrada** | { <br> valorTotal: Centavos;   // total do orçamento: itens com imposto + frete <br> } |
| **Retorno** | { condicao: 'ADIANTADO_50_50'; valorAdiantado: Centavos; valorRestante: Centavos } <br> valorAdiantado = 50% do total, arredondado para cima; valorRestante = valorTotal − valorAdiantado (a soma sempre fecha o total). <br> Erros: CALC_ENTRADA_INVALIDA. |


#### 11.6.3.2 Frete


**Calcular frete**


| **Nome da Função** | calcularFrete |
|---|---|
| **Descrição** | Define a modalidade de frete (CIF ou FOB) e, quando aplicável, seu valor, com base no valor total da compra. |
| **Fórmula/Regra aplicada** | CIF para compras a partir de R$ 1.500 (assumido integralmente pela SupriMax, sem custo adicional destacado). FOB para compras abaixo de R$ 1.500 (o faturamento mínimo é regra separada): frete cotado pela SupriMax junto a uma transportadora (valor sempre destacado no orçamento e na Nota Fiscal, sem diluição no preço dos produtos) ou indicado pelo próprio cliente. |
| **Parâmetros de entrada** | { <br> valorTotalItens: Centavos;   // com imposto, sem frete <br> origemTransportadora?: OrigemTransportadora;   // obrigatória no FOB <br> valorFreteCotado?: Centavos \| null;   // FOB com origem SUPRIMAX; null = ainda não cotado <br> } |
| **Retorno** | { modalidade: 'CIF'; valorFrete: null; provisorio: false; origemTransportadora: null } <br> ou { modalidade: 'FOB'; valorFrete: Centavos \| null; provisorio: boolean; origemTransportadora: OrigemTransportadora } <br> FOB com origem SUPRIMAX e valor ainda não cotado: valorFrete null e provisorio true. FOB com origem CLIENTE: valorFrete null e provisorio false. <br> Erros: CALC_ENTRADA_INVALIDA (inclusive FOB sem origemTransportadora). |


#### 11.6.3.3 Imposto


**Calcular imposto do item**


| **Nome da Função** | calcularImpostoItem |
|---|---|
| **Descrição** | Calcula o valor do imposto e o valor total de um item do orçamento, aplicando a alíquota fixa da SupriMax (optante do Simples Nacional, sem recolhimento de DIFAL). |
| **Fórmula/Regra aplicada** | Por linha do orçamento: Valor da linha = quantidade × preço unitário aplicado. Valor do Imposto = Valor da linha × 18%, arredondado uma única vez (meio para cima, 2 casas). Valor Total do Item = Valor da linha + Valor do Imposto. Exemplo: 10 unidades a R$ 100,00 → linha = R$ 1.000,00 → imposto = R$ 180,00 → total do item = R$ 1.180,00. |
| **Parâmetros de entrada** | { <br> quantidade: number;   // fardos (FARDO) ou unidades (AVULSO); inteiro > 0 <br> precoUnitarioAplicado: Centavos;   // preço do fardo inteiro quando FARDO <br> } |
| **Retorno** | { valorLinha: Centavos; imposto: Centavos; totalItem: Centavos } <br> Erros: CALC_ENTRADA_INVALIDA. |


**Detalhamento do cálculo por linha**


Uma linha é um registro de `item_orcamento`: uma variação de produto comprada de uma das duas formas.


| **Granularidade** | **Quantidade** | **Preço aplicado** | **Valor da linha** |
|---|---|---|---|
| FARDO | quantidade_fardos | preço fixo do fardo | fardos × preço do fardo |
| AVULSO | quantidade_avulsa | preço unitário da faixa | quantidade × preço da faixa |


`preco_unitario_aplicado` guarda o preço do fardo inteiro quando a granularidade é `FARDO`; o número de unidades dentro do fardo não entra na conta.


**Passo a passo em centavos inteiros**


Para 10 unidades a R$ 10,55, a linha vale `10550`. Então: `10550 × 18 = 189900`; `+ 50 = 189950`; `÷ 100 = 1899,5`; `floor` = `1899` (R$ 18,99). Somar 50 antes de dividir é o que faz o arredondamento ser “meio para cima”, igual ao `ROUND` de `NUMERIC` do Postgres para valores positivos.


**Exemplos**


| **Caso** | **Linha** | **Imposto** | **Total do item** |
|---|---|---|---|
| 10 un. × R$ 100,00 | R$ 1.000,00 | R$ 180,00 | R$ 1.180,00 |
| 10 un. × R$ 10,55 | R$ 105,50 | R$ 18,99 | R$ 124,49 |
| 2 fardos × R$ 47,50 | R$ 95,00 | R$ 17,10 | R$ 112,10 |


**Por que por linha, e não por unidade**


O CHECK do banco exige `valor_imposto = ROUND(base × 0,18; 2)` sobre a linha. Para 10 un. × R$ 10,55:


| **Forma de calcular** | **Imposto** | **Passa no CHECK?** |
|---|---|---|
| Por unidade, multiplicado | R$ 1,90 × 10 = R$ 19,00 | Não (diverge 1 centavo) |
| **Por linha** | R$ 105,50 × 18% = **R$ 18,99** | **Sim** |
| Sobre o total do pedido | depende das outras linhas | Não (o banco confere cada linha) |


Com R$ 100,00 × 10 as três formas dão o mesmo valor; a diferença só aparece quando o preço não “fecha” em centavos. O erro do cálculo por unidade cresce com a quantidade: com 1.000 un. × R$ 1,05, por unidade dá R$ 190,00 (R$ 0,19 × 1.000) e por linha dá R$ 189,00.


**O total do pedido pode diferir 1 centavo de “18% do total”**


Como cada linha arredonda sozinha, a soma dos impostos das linhas pode não bater com 18% do subtotal:


| **Linha** | **Base** | **Imposto exato** | **Imposto arredondado** |
|---|---|---|---|
| 3 × R$ 1,05 | R$ 3,15 | R$ 0,567 | R$ 0,57 |
| 7 × R$ 3,33 | R$ 23,31 | R$ 4,1958 | R$ 4,20 |
| **Soma das linhas** | R$ 26,46 |  | **R$ 4,77** |


Aplicando 18% direto sobre R$ 26,46, o imposto seria R$ 4,76. O valor correto do orçamento é o de R$ 4,77 (soma das linhas), porque é o que o banco aceita e o que aparece destacado por item no PDF. Isso é normal em documento com imposto por item, mas quem conferir o total na calculadora pode estranhar.


**Efeito nos limites**


Os limites de R$ 500 e R$ 1.500 são comparados com a soma dos totais das linhas (com imposto, sem frete). Como essa soma usa os valores já arredondados por linha, o valor comparado é o mesmo que está gravado no banco.


#### 11.6.3.4 Estoque


**Validar disponibilidade de estoque**


| **Nome da Função** | validarDisponibilidadeEstoque |
|---|---|
| **Descrição** | Verifica se uma variação específica de um produto (ex.: tamanho/embalagem) possui quantidade positiva em estoque à pronta entrega (saldo disponível = saldo físico − reservas vigentes (CONFIRMADA), recebido como parâmetro), antes de permitir sua inclusão no orçamento. |
| **Fórmula/Regra aplicada** | Se a variação específica estiver indisponível, a inclusão é bloqueada mesmo que outra variação do mesmo produto tenha estoque (o preço pode variar entre variações). Itens sem estoque disponível são encaminhados ao departamento de compras, fora do escopo deste módulo. |
| **Parâmetros de entrada** | { <br> saldoDisponivel: number;   // em unidades: saldo físico − reservas CONFIRMADA <br> quantidadeSolicitada: number;   // fardos (FARDO) ou unidades (AVULSO) <br> granularidade: Granularidade; <br> unidadesPorFardo?: number;   // obrigatório quando FARDO <br> } |
| **Retorno** | { ok: true; saldoRestante: number }   // saldoRestante em unidades <br> ou { ok: false; motivo: 'ESTOQUE_ZERADO' \| 'SALDO_INSUFICIENTE'; maximoDisponivel: number }   // na mesma unidade da solicitação (fardos inteiros, quando FARDO) <br> Erros: CALC_ENTRADA_INVALIDA. |


#### 11.6.3.5 Orçamento


**Formatar número do orçamento**


| **Nome da Função** | formatarNumeroOrcamento |
|---|---|
| **Descrição** | Formata e valida o número sequencial do orçamento. O número é gerado pela sequence do banco (seção 13.4); o módulo não gera nem consulta a sequência. |
| **Fórmula/Regra aplicada** | Sequencial, única e crescente, com no mínimo 5 dígitos (00001, 00002…; passados 99999, 100000 e seguintes), sem reinício e sem vínculo com a data. Aceita qualquer inteiro maior ou igual a 1. |
| **Parâmetros de entrada** | { <br> numero: number;   // inteiro >= 1, vindo da sequence do banco <br> } |
| **Retorno** | { numeroFormatado: string }   // 12 → '00012'; 100000 → '100000' <br> Erros: CALC_NUMERO_INVALIDO. |


**Calcular validade do orçamento**


| **Nome da Função** | calcularValidadeOrcamento |
|---|---|
| **Descrição** | Calcula a data-limite em que o cliente pode fechar a compra com o preço ofertado. |
| **Fórmula/Regra aplicada** | Data de emissão + 30 dias. |
| **Parâmetros de entrada** | { <br> dataEmissao: DataISO;   // 'AAAA-MM-DD' <br> } |
| **Retorno** | { dataValidade: DataISO }   // dataEmissao + 30 dias, aritmética em UTC <br> Erros: CALC_DATA_INVALIDA. |


#### 11.6.3.6 Fechamento por item


**Recalcular orçamento sobre as quantidades aprovadas**


| **Nome da Função** | recalcularOrcamentoAprovado |
|---|---|
| **Descrição** | Recalcula os itens aprovados de um orçamento emitido sobre as quantidades aprovadas pelo cliente e, quando todos os itens estão aprovados, informa se o total aceito atende às regras comerciais. |
| **Fórmula/Regra aplicada** | Itens AVULSO: aplica a faixa de preço correspondente à quantidade aprovada e recalcula linha e imposto (seção 4.3). Itens FARDO: mantêm o preço fixo do pacote × fardos aprovados. Quantidade aprovada zero: NAO_APROVADO. Enquanto houver item não aprovado, não aplica mínimo nem frete. Com todos os itens aprovados, aplica o faturamento mínimo e a regra de frete CIF/FOB sobre o total aceito (com imposto, sem frete; seção 11.6.2.1). Total abaixo do mínimo: retorna { ok: false, motivo: 'ABAIXO_DO_MINIMO' }. |
| **Parâmetros de entrada** | { <br> itens: Array<{ <br> idItem: number; granularidade: Granularidade; <br> quantidadeCotada: number; quantidadeAprovada: number;   // 0 = NAO_APROVADO; nunca maior que a cotada <br> precoFardo?: Centavos;   // FARDO: preço fixo do pacote <br> faixas?: Array<{ idFaixaPreco: number; quantidadeMinima: number; precoUnitario: Centavos }>;   // AVULSO <br> }>; <br> primeiraCompra: boolean;   // na primeira compra não há faturamento mínimo <br> origemTransportadora?: OrigemTransportadora; <br> valorFreteCotado?: Centavos \| null; <br> } |
| **Retorno** | { <br> itens: Array<{ idItem: number; situacao: 'APROVADO' \| 'NAO_APROVADO'; quantidadeAprovada: number; <br> idFaixaPrecoAceita: number \| null; precoUnitarioAceito: Centavos \| null; <br> valorLinha: Centavos; imposto: Centavos; totalItem: Centavos }>; <br> valorTotalItensAprovado: Centavos;   // soma dos totalItem dos itens aprovados <br> valorTotalImpostoAprovado: Centavos; <br> todosAprovados: boolean; <br> fechamento: null   // enquanto houver item não aprovado <br> \| { ok: true; frete: ResultadoFrete; valorTotalAceito: Centavos }   // itens aprovados + frete <br> \| { ok: false; motivo: 'ABAIXO_DO_MINIMO' }; <br> } <br> ResultadoFrete é o retorno de calcularFrete. Erros: CALC_ENTRADA_INVALIDA, CALC_FAIXA_NAO_ENCONTRADA, CALC_GRANULARIDADE_INVALIDA. |


### 11.6.4 Resumo das funções


O módulo expõe oito funções, todas puras, especificadas na seção 11.6.3.


| **Função** | **Domínio (seção)** |
|---|---|
| **validarCondicaoFaturamento** | Faturamento e crédito (11.6.3.1) |
| **calcularCondicaoCreditoReprovado** | Faturamento e crédito (11.6.3.1) |
| **calcularFrete** | Frete (11.6.3.2) |
| **calcularImpostoItem** | Imposto (11.6.3.3) |
| **validarDisponibilidadeEstoque** | Estoque (11.6.3.4) |
| **formatarNumeroOrcamento** | Orçamento (11.6.3.5) |
| **calcularValidadeOrcamento** | Orçamento (11.6.3.5) |
| **recalcularOrcamentoAprovado** | Fechamento por item (11.6.3.6) |
