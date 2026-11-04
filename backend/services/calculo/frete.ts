// UC18 — docs/11, seção 11.6.3.2.
import { CalculoError } from './erros';
import { LIMITE_CIF } from './regras';
import { validarInteiroNaoNegativo } from './validacao';
import type { Centavos, OrigemTransportadora, ResultadoFrete } from './types';

export function calcularFrete({
  valorTotalItens,
  origemTransportadora,
  valorFreteCotado,
}: {
  valorTotalItens: Centavos;
  origemTransportadora?: OrigemTransportadora;
  valorFreteCotado?: Centavos | null;
}): ResultadoFrete {
  validarInteiroNaoNegativo(valorTotalItens, 'valorTotalItens');
  if (valorTotalItens >= LIMITE_CIF) {
    return { modalidade: 'CIF', valorFrete: null, provisorio: false, origemTransportadora: null };
  }
  if (origemTransportadora !== 'SUPRIMAX' && origemTransportadora !== 'CLIENTE') {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      'origemTransportadora',
      'obrigatória para frete FOB',
    );
  }
  if (origemTransportadora === 'CLIENTE') {
    if (valorFreteCotado !== undefined && valorFreteCotado !== null) {
      validarInteiroNaoNegativo(valorFreteCotado, 'valorFreteCotado');
    }
    return { modalidade: 'FOB', valorFrete: null, provisorio: false, origemTransportadora };
  }
  if (valorFreteCotado === undefined || valorFreteCotado === null) {
    return { modalidade: 'FOB', valorFrete: null, provisorio: true, origemTransportadora };
  }
  validarInteiroNaoNegativo(valorFreteCotado, 'valorFreteCotado');
  return {
    modalidade: 'FOB',
    valorFrete: valorFreteCotado,
    provisorio: false,
    origemTransportadora,
  };
}
