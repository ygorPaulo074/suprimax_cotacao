// UC18 — docs/11, seção 11.6.3.1.
import { CalculoError } from './erros';
import { FATURAMENTO_MINIMO, LIMITE_PARCELAMENTO, PARCELA_MINIMA } from './regras';
import type { Centavos, ResultadoCredito, ResultadoFaturamento } from './types';
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
