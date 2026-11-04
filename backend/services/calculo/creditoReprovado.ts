// UC18 — docs/11, seção 11.6.3.1 — 50% adiantado arredondado para cima + restante fecha o total
import { CalculoError } from './erros';
import { PERCENTUAL_ADIANTAMENTO } from './regras';
import type { Centavos } from './types';

export function calcularCondicaoCreditoReprovado({ valorTotal }: { valorTotal: Centavos }): {
  condicao: 'ADIANTADO_50_50';
  valorAdiantado: Centavos;
  valorRestante: Centavos;
} {
  if (!Number.isInteger(valorTotal) || valorTotal <= 0) {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      'valorTotal',
      `centavos inteiros > 0 esperado; recebido ${valorTotal}`,
    );
  }

  const valorAdiantado = Math.ceil((valorTotal * PERCENTUAL_ADIANTAMENTO) / 100);
  return {
    condicao: 'ADIANTADO_50_50',
    valorAdiantado,
    valorRestante: valorTotal - valorAdiantado,
  };
}
