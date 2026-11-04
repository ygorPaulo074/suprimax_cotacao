// UC18 — tabela de casos da condição alternativa para crédito reprovado.
import { calcularCondicaoCreditoReprovado } from './creditoReprovado';
import { CalculoError } from './erros';

describe('calcularCondicaoCreditoReprovado', () => {
  it.each([
    [10000, 5000, 5000],
    [150000, 75000, 75000],
    [1, 1, 0],
    [49999, 25000, 24999],
  ])(
    'divide o total em duas condições: %d centavos',
    (valorTotal, valorAdiantado, valorRestante) => {
      expect(calcularCondicaoCreditoReprovado({ valorTotal })).toEqual({
        condicao: 'ADIANTADO_50_50',
        valorAdiantado,
        valorRestante,
      });
    },
  );

  it.each([0, -1, 1.5, NaN, '100', null, undefined])('rejeita total inválido: %p', (valorTotal) => {
    expect(() => calcularCondicaoCreditoReprovado({ valorTotal: valorTotal as number })).toThrow(
      CalculoError,
    );
    expect(() => calcularCondicaoCreditoReprovado({ valorTotal: valorTotal as number })).toThrow(
      /CALC_ENTRADA_INVALIDA/,
    );
  });
});
