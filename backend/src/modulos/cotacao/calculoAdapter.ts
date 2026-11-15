// UC14-19 — ponte entre o backend e `backend/services/calculo` (docs/11, seção 11.6). Este
// arquivo não duplica regra: só adapta os tipos do domínio do backend (já convertidos de
// DECIMAL/snake_case) para o formato das funções puras, e resolve a seleção de faixa de preço por
// quantidade, que não é uma das 8 funções do módulo (quem escolhe a faixa é quem chama).
import {
  calcularCondicaoCreditoReprovado,
  calcularFrete,
  calcularImpostoItem,
  calcularValidadeOrcamento,
  CalculoError,
  formatarNumeroOrcamento,
  recalcularOrcamentoAprovado,
  validarCondicaoFaturamento,
  validarDisponibilidadeEstoque,
  type Centavos,
  type CondicaoPagamento,
  type DataISO,
  type FaixaPreco,
  type Granularidade,
  type ItemOrcamentoAprovado,
  type ItemRecalculado,
  type OrigemTransportadora,
  type ResultadoCredito,
  type ResultadoFaturamento,
  type ResultadoFrete,
} from '../../../services/calculo';
import { ErroDeValidacao, ErroInterno } from '../../erros';

// Reexportado para quem monta `condicoes`/itens sem precisar conhecer o caminho do módulo.
export {
  calcularCondicaoCreditoReprovado,
  calcularFrete,
  calcularImpostoItem,
  calcularValidadeOrcamento,
  formatarNumeroOrcamento,
  recalcularOrcamentoAprovado,
  validarCondicaoFaturamento,
  validarDisponibilidadeEstoque,
};
export type {
  Centavos,
  CondicaoPagamento,
  DataISO,
  FaixaPreco,
  Granularidade,
  ItemOrcamentoAprovado,
  ItemRecalculado,
  OrigemTransportadora,
  ResultadoCredito,
  ResultadoFaturamento,
  ResultadoFrete,
};

/** Fardo escolhido para um item FARDO (preço fixo do pacote). */
export interface FardoEscolhido {
  readonly idFardo: number;
  readonly quantidadeUnidades: number;
  readonly precoFixo: Centavos;
}

/** Entrada para calcular uma linha de item (UC16, UC18, 11.6.3.3). */
export interface EntradaDaLinha {
  readonly granularidade: Granularidade;
  readonly quantidade: number;
  /** Obrigatório quando `granularidade` é FARDO. */
  readonly fardo?: FardoEscolhido;
  /** Faixas da variação, ordenadas por `quantidadeMinima`; obrigatórias quando AVULSO. */
  readonly faixas?: readonly FaixaPreco[];
}

/** Linha calculada: preço aplicado, faixa escolhida (quando AVULSO) e totais (11.6.3.3). */
export interface LinhaCalculada {
  readonly precoUnitarioAplicado: Centavos;
  /** `null` quando a granularidade é FARDO. */
  readonly idFaixaPreco: number | null;
  readonly valorLinha: Centavos;
  readonly imposto: Centavos;
  readonly totalItem: Centavos;
}

/**
 * Escolhe a faixa de preço vigente para a quantidade: a de maior `quantidadeMinima` que ainda é
 * menor ou igual à quantidade (RN08 — ex.: 1 a 3 un. = R$ 25,00; a partir de 4 = R$ 19,00). O
 * módulo de cálculo não decide isso: `calcularImpostoItem` já recebe o preço escolhido.
 *
 * @throws {ErroDeValidacao} Se nenhuma faixa cobrir a quantidade (CALC_FAIXA_NAO_ENCONTRADA do
 * módulo descreve o mesmo caso em `recalcularOrcamentoAprovado`; aqui vira erro de validação
 * porque a causa é o pedido do operador, não uma falha interna).
 */
export function selecionarFaixaDePreco(
  faixas: readonly FaixaPreco[],
  quantidade: number,
): FaixaPreco {
  const vigente = [...faixas]
    .filter((faixa) => faixa.quantidadeMinima <= quantidade)
    .sort((a, b) => b.quantidadeMinima - a.quantidadeMinima)[0];
  if (!vigente) {
    throw new ErroDeValidacao({
      mensagem: 'Nenhuma faixa de preço atende a esta quantidade.',
      detalhes: { campos: ['quantidade'] },
    });
  }
  return vigente;
}

/**
 * Calcula preço aplicado, imposto e total de uma linha do orçamento (UC16, 11.6.3.3), já
 * escolhendo a faixa de preço quando a granularidade é AVULSO.
 *
 * @throws {ErroDeValidacao} Dados de granularidade incompatíveis, ou nenhuma faixa para a
 * quantidade.
 */
export function calcularLinhaDoItem(entrada: EntradaDaLinha): LinhaCalculada {
  const { granularidade, quantidade, fardo, faixas } = entrada;
  try {
    if (granularidade === 'FARDO') {
      if (!fardo) {
        throw new ErroDeValidacao({ mensagem: 'Fardo obrigatório para granularidade FARDO.' });
      }
      const { valorLinha, imposto, totalItem } = calcularImpostoItem({
        quantidade,
        precoUnitarioAplicado: fardo.precoFixo,
      });
      return {
        precoUnitarioAplicado: fardo.precoFixo,
        idFaixaPreco: null,
        valorLinha,
        imposto,
        totalItem,
      };
    }
    const faixaEscolhida = selecionarFaixaDePreco(faixas ?? [], quantidade);
    const { valorLinha, imposto, totalItem } = calcularImpostoItem({
      quantidade,
      precoUnitarioAplicado: faixaEscolhida.precoUnitario,
    });
    return {
      precoUnitarioAplicado: faixaEscolhida.precoUnitario,
      idFaixaPreco: faixaEscolhida.idFaixaPreco,
      valorLinha,
      imposto,
      totalItem,
    };
  } catch (erro) {
    throw traduzirErroDeCalculo(erro);
  }
}

/**
 * Traduz um `CalculoError` (entrada inválida, falha de quem chama) em `ErroDeValidacao`, sem
 * expor campo/detalhe interno ao frontend (docs/11, seção 11.6.2.3). Qualquer outro erro é
 * repassado como está.
 */
export function traduzirErroDeCalculo(erro: unknown): Error {
  if (erro instanceof CalculoError) {
    return new ErroDeValidacao({ causa: erro });
  }
  return erro instanceof Error ? erro : new ErroInterno(erro);
}

/** Hoje em formato `DataISO` ('AAAA-MM-DD'), em UTC (convenção do módulo, seção 11.6.2.1). */
export function hojeComoDataISO(agora: Date): DataISO {
  return agora.toISOString().slice(0, 10);
}
