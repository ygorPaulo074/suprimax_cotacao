// UC18 — docs/11, seção 11.6.3.4.
import { CalculoError } from './erros';
import type { Granularidade } from './types';
import { validarInteiroNaoNegativo, validarQuantidadePositiva } from './validacao';

export function validarDisponibilidadeEstoque({
  saldoDisponivel,
  quantidadeSolicitada,
  granularidade,
  unidadesPorFardo,
}: {
  saldoDisponivel: number;
  quantidadeSolicitada: number;
  granularidade: Granularidade;
  unidadesPorFardo?: number;
}):
  | { ok: true; saldoRestante: number }
  | { ok: false; motivo: 'ESTOQUE_ZERADO' | 'SALDO_INSUFICIENTE'; maximoDisponivel: number } {
  validarInteiroNaoNegativo(saldoDisponivel, 'saldoDisponivel');
  validarQuantidadePositiva(quantidadeSolicitada);
  if (granularidade !== 'FARDO' && granularidade !== 'AVULSO') {
    throw new CalculoError(
      'CALC_GRANULARIDADE_INVALIDA',
      'granularidade',
      `recebido ${granularidade}`,
    );
  }
  let saldoNaUnidade = saldoDisponivel;
  if (granularidade === 'FARDO') {
    if (!Number.isInteger(unidadesPorFardo) || (unidadesPorFardo as number) <= 0) {
      throw new CalculoError('CALC_ENTRADA_INVALIDA', 'unidadesPorFardo', 'inteiro > 0 esperado');
    }
    saldoNaUnidade = Math.floor(saldoDisponivel / (unidadesPorFardo as number));
  }
  if (saldoNaUnidade === 0) return { ok: false, motivo: 'ESTOQUE_ZERADO', maximoDisponivel: 0 };
  if (quantidadeSolicitada > saldoNaUnidade)
    return { ok: false, motivo: 'SALDO_INSUFICIENTE', maximoDisponivel: saldoNaUnidade };
  return { ok: true, saldoRestante: saldoNaUnidade - quantidadeSolicitada };
}
