// docs/11, seção 11.6.3.3 — imposto por linha, arredondado uma única vez (meio para cima).
import { CalculoError } from './erros';
import { ALIQUOTA_IMPOSTO_PERCENTUAL } from './regras';
import type { Centavos } from './types';

export function calcularImpostoItem({
  quantidade,
  precoUnitarioAplicado,
}: {
  quantidade: number; // fardos (FARDO) ou unidades (AVULSO); inteiro > 0
  precoUnitarioAplicado: Centavos; // preço do fardo inteiro quando FARDO
}): { valorLinha: Centavos; imposto: Centavos; totalItem: Centavos } {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      'quantidade',
      `inteiro > 0 esperado; recebido ${quantidade}`,
    );
  }
  if (!Number.isInteger(precoUnitarioAplicado) || precoUnitarioAplicado < 0) {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      'precoUnitarioAplicado',
      `centavos inteiros >= 0 esperado; recebido ${precoUnitarioAplicado}`,
    );
  }

  const valorLinha = quantidade * precoUnitarioAplicado;
  // meio para cima, uma única vez, em centavos inteiros
  const imposto = Math.floor((valorLinha * ALIQUOTA_IMPOSTO_PERCENTUAL + 50) / 100);
  return { valorLinha, imposto, totalItem: valorLinha + imposto };
}
