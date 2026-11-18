// UC18 — docs/11, seção 11.6.3.1.
import { CalculoError } from './erros';
import { FATURAMENTO_MINIMO, LIMITE_PARCELAMENTO, PARCELA_MINIMA } from './regras';
import type { Centavos, CondicaoPagamento, ResultadoCredito, ResultadoFaturamento } from './types';
import { validarInteiroNaoNegativo, validarParcelas, validarPrazo } from './validacao';

export function validarCondicaoFaturamento({
  valorTotalItens,
  primeiraCompra,
  resultadoCredito,
  prazoDias,
  numeroParcelas,
}: {
  valorTotalItens: Centavos;
  primeiraCompra: boolean;
  resultadoCredito: ResultadoCredito;
  prazoDias?: number;
  numeroParcelas?: number;
}): ResultadoFaturamento {
  validarInteiroNaoNegativo(valorTotalItens, 'valorTotalItens');
  if (typeof primeiraCompra !== 'boolean') {
    throw new CalculoError('CALC_ENTRADA_INVALIDA', 'primeiraCompra', 'booleano esperado');
  }
  if (
    resultadoCredito !== null &&
    resultadoCredito !== 'APROVADO' &&
    resultadoCredito !== 'REPROVADO'
  ) {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      'resultadoCredito',
      `APROVADO, REPROVADO ou null esperado; recebido ${resultadoCredito}`,
    );
  }

  if (primeiraCompra) {
    return {
      ok: true,
      condicao: 'ADIANTADO_100',
      prazoDias: null,
      numeroParcelas: null,
      valorParcela: null,
      exigeAnaliseCredito: false,
    };
  }

  if (numeroParcelas !== undefined) {
    validarParcelas(numeroParcelas);
    if (valorTotalItens < FATURAMENTO_MINIMO) return { ok: false, motivo: 'ABAIXO_DO_MINIMO' };
    if (valorTotalItens < LIMITE_PARCELAMENTO)
      return { ok: false, motivo: 'PARCELAMENTO_INDISPONIVEL' };
    const valorParcela = Math.floor(valorTotalItens / numeroParcelas);
    if (valorParcela < PARCELA_MINIMA) return { ok: false, motivo: 'PARCELA_ABAIXO_DO_MINIMO' };
    if (resultadoCredito === null) return { ok: false, motivo: 'CREDITO_PENDENTE' };
    if (resultadoCredito === 'REPROVADO') return { ok: false, motivo: 'CREDITO_REPROVADO' };
    return {
      ok: true,
      condicao: 'PARCELADO',
      prazoDias: null,
      numeroParcelas,
      valorParcela,
      exigeAnaliseCredito: true,
    };
  }

  if (prazoDias === undefined) {
    throw new CalculoError('CALC_PRAZO_INVALIDO', 'prazoDias', 'obrigatório para boleto');
  }
  validarPrazo(prazoDias);
  if (valorTotalItens < FATURAMENTO_MINIMO) return { ok: false, motivo: 'ABAIXO_DO_MINIMO' };
  if (resultadoCredito === null) return { ok: false, motivo: 'CREDITO_PENDENTE' };
  if (resultadoCredito === 'REPROVADO') return { ok: false, motivo: 'CREDITO_REPROVADO' };
  return {
    ok: true,
    condicao: 'BOLETO',
    prazoDias,
    numeroParcelas: null,
    valorParcela: null,
    exigeAnaliseCredito: true,
  };
}

/**
 * Quanto falta para o faturamento mínimo (UC18, RN17; docs/04, seção 4.2). O mínimo vale a partir
 * da segunda compra do cliente e é inclusivo: exatamente R$ 500,00 já atende. Devolve 0 quando
 * atende ou quando é a primeira compra.
 */
export function calcularFaltaParaFaturamentoMinimo({
  valorTotalItens,
  primeiraCompra,
}: {
  valorTotalItens: Centavos;
  primeiraCompra: boolean;
}): Centavos {
  validarInteiroNaoNegativo(valorTotalItens, 'valorTotalItens');
  if (typeof primeiraCompra !== 'boolean') {
    throw new CalculoError('CALC_ENTRADA_INVALIDA', 'primeiraCompra', 'booleano esperado');
  }
  if (primeiraCompra) return 0;
  return Math.max(0, FATURAMENTO_MINIMO - valorTotalItens);
}

/**
 * Condições de pagamento que o orçamento pode usar (UC18, docs/04, seções 4.1 e 4.2). Limites
 * inclusivos: boleto a partir de R$ 500,00 e parcelado a partir de R$ 1.500,00. `valorTotalItens`
 * igual a 0 (orçamento sem itens) não restringe por valor, porque ainda não há total a avaliar.
 */
export function listarCondicoesPermitidas({
  valorTotalItens,
  primeiraCompra,
  resultadoCredito,
}: {
  valorTotalItens: Centavos;
  primeiraCompra: boolean;
  resultadoCredito: ResultadoCredito;
}): CondicaoPagamento[] {
  validarInteiroNaoNegativo(valorTotalItens, 'valorTotalItens');
  if (typeof primeiraCompra !== 'boolean') {
    throw new CalculoError('CALC_ENTRADA_INVALIDA', 'primeiraCompra', 'booleano esperado');
  }
  if (primeiraCompra) return ['ADIANTADO_100'];
  if (resultadoCredito === 'REPROVADO') return ['ADIANTADO_100', 'ADIANTADO_50_50'];
  const semItens = valorTotalItens === 0;
  const condicoes: CondicaoPagamento[] = ['ADIANTADO_100'];
  if (semItens || valorTotalItens >= FATURAMENTO_MINIMO) condicoes.push('BOLETO');
  if (semItens || valorTotalItens >= LIMITE_PARCELAMENTO) condicoes.push('PARCELADO');
  return condicoes;
}

/**
 * Condição de pagamento que o sistema aplica sozinho (UC18). Ponto único da regra: para mudar o
 * padrão, altere só esta função. Primeira compra: 100% adiantado (a única permitida). Crédito
 * reprovado: 50% adiantado + 50% após a entrega. Demais casos: 100% adiantado, a mais segura.
 * Só devolve condições que não exigem `prazoDias` nem `numeroParcelas`, e sempre uma que
 * `listarCondicoesPermitidas` aceita para os mesmos dados. Boleto e parcelado ficam a cargo do operador.
 */
export function escolherCondicaoPadrao({
  primeiraCompra,
  resultadoCredito,
}: {
  primeiraCompra: boolean;
  resultadoCredito: ResultadoCredito;
}): CondicaoPagamento {
  if (typeof primeiraCompra !== 'boolean') {
    throw new CalculoError('CALC_ENTRADA_INVALIDA', 'primeiraCompra', 'booleano esperado');
  }
  if (!primeiraCompra && resultadoCredito === 'REPROVADO') return 'ADIANTADO_50_50';
  return 'ADIANTADO_100';
}
