// docs/11, seção 11.6.2.3. Validações compartilhadas do módulo de cálculo.
import { CalculoError } from './erros';
import { MAXIMO_PARCELAS, PRAZOS_BOLETO_DIAS } from './regras';
import type { Centavos, DataISO } from './types';

export function validarInteiroNaoNegativo(
  valor: unknown,
  nomeCampo: string,
): asserts valor is Centavos {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor < 0) {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      nomeCampo,
      `inteiro >= 0 esperado; recebido ${valor}`,
    );
  }
}

export function validarQuantidadePositiva(
  quantidade: unknown,
  nomeCampo = 'quantidade',
): asserts quantidade is number {
  if (typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade <= 0) {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      nomeCampo,
      `inteiro > 0 esperado; recebido ${quantidade}`,
    );
  }
}

export function validarPrazo(prazo: unknown, nomeCampo = 'prazoDias'): asserts prazo is number {
  const prazoPermitido =
    typeof prazo === 'number' && PRAZOS_BOLETO_DIAS.some((prazoDaRegra) => prazoDaRegra === prazo);
  if (!prazoPermitido) {
    throw new CalculoError(
      'CALC_PRAZO_INVALIDO',
      nomeCampo,
      `prazo permitido: ${PRAZOS_BOLETO_DIAS.join(', ')}; recebido ${prazo}`,
    );
  }
}

export function validarParcelas(
  parcelas: unknown,
  nomeCampo = 'numeroParcelas',
): asserts parcelas is number {
  if (
    typeof parcelas !== 'number' ||
    !Number.isInteger(parcelas) ||
    parcelas < 2 ||
    parcelas > MAXIMO_PARCELAS
  ) {
    throw new CalculoError(
      'CALC_PARCELAS_INVALIDAS',
      nomeCampo,
      `2..${MAXIMO_PARCELAS} inteiras esperado; recebido ${parcelas}`,
    );
  }
}

export function validarDataISO(data: unknown, nomeCampo = 'dataEmissao'): asserts data is DataISO {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new CalculoError(
      'CALC_DATA_INVALIDA',
      nomeCampo,
      `formato 'AAAA-MM-DD' esperado; recebido ${data}`,
    );
  }

  const partes = data.split('-').map(Number) as [number, number, number];
  const [ano, mes, dia] = partes;
  const dataUTC = new Date(0);
  dataUTC.setUTCHours(0, 0, 0, 0);
  dataUTC.setUTCFullYear(ano, mes - 1, dia);

  const dataValida =
    dataUTC.getUTCFullYear() === ano &&
    dataUTC.getUTCMonth() === mes - 1 &&
    dataUTC.getUTCDate() === dia;
  if (!dataValida) {
    throw new CalculoError(
      'CALC_DATA_INVALIDA',
      nomeCampo,
      `data inexistente no calendário; recebido ${data}`,
    );
  }
}

export function validarNumero(numero: unknown, nomeCampo = 'numero'): asserts numero is number {
  if (typeof numero !== 'number' || !Number.isInteger(numero) || numero < 1) {
    throw new CalculoError(
      'CALC_NUMERO_INVALIDO',
      nomeCampo,
      `inteiro >= 1 esperado; recebido ${numero}`,
    );
  }
}
