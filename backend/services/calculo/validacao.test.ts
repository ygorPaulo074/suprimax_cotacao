// UC18, UC19 e UC20 — cobertura das validações compartilhadas.
import {
  validarInteiroNaoNegativo,
  validarQuantidadePositiva,
  validarPrazo,
  validarParcelas,
  validarDataISO,
  validarNumero,
} from './validacao';
import { CalculoError } from './erros';

type CasoValidacao = readonly [unknown, boolean];

describe('validações compartilhadas', () => {
  describe('validarInteiroNaoNegativo', () => {
    const casos: CasoValidacao[] = [
      [0, true],
      [1, true],
      [999999, true],
      [-1, false],
      [-999, false],
      [NaN, false],
      [1.5, false],
      ['100', false],
      [null, false],
      [undefined, false],
    ];
    it.each(casos)('valida valor %p', (valor, valido) => {
      if (valido) expect(() => validarInteiroNaoNegativo(valor, 'campo')).not.toThrow();
      else {
        expect(() => validarInteiroNaoNegativo(valor, 'campo')).toThrow(CalculoError);
        expect(() => validarInteiroNaoNegativo(valor, 'campo')).toThrow(/CALC_ENTRADA_INVALIDA/);
      }
    });
    it('valida número negativo com detalhes', () => {
      expect(() => validarInteiroNaoNegativo(-5, 'preco')).toThrow(CalculoError);
      expect(() => validarInteiroNaoNegativo(-5, 'preco')).toThrow('inteiro >= 0 esperado');
    });
  });

  describe('validarQuantidadePositiva', () => {
    const casos: CasoValidacao[] = [
      [1, true],
      [999, true],
      [0, false],
      [-1, false],
      [1.5, false],
      [NaN, false],
      ['10', false],
    ];
    it.each(casos)('valida valor %p', (valor, valido) => {
      if (valido) expect(() => validarQuantidadePositiva(valor)).not.toThrow();
      else {
        expect(() => validarQuantidadePositiva(valor)).toThrow(CalculoError);
        expect(() => validarQuantidadePositiva(valor)).toThrow(/CALC_ENTRADA_INVALIDA/);
      }
    });
  });

  describe('validarPrazo', () => {
    const casos: CasoValidacao[] = [
      [10, true],
      [15, true],
      [20, true],
      [28, true],
      [30, true],
      [5, false],
      [35, false],
      [0, false],
      [-5, false],
      [NaN, false],
      ['10', false],
    ];
    it.each(casos)('valida valor %p', (valor, valido) => {
      if (valido) expect(() => validarPrazo(valor)).not.toThrow();
      else {
        expect(() => validarPrazo(valor)).toThrow(CalculoError);
        expect(() => validarPrazo(valor)).toThrow(/CALC_PRAZO_INVALIDO/);
      }
    });
    it('gera detalhes de prazo inválido', () =>
      expect(() => validarPrazo(7)).toThrow('prazo permitido:'));
  });

  describe('validarParcelas', () => {
    const casos: CasoValidacao[] = [
      [2, true],
      [3, true],
      [6, true],
      [7, false],
      [1, false],
      [0, false],
      [-1, false],
      [NaN, false],
      ['2', false],
    ];
    it.each(casos)('valida valor %p', (valor, valido) => {
      if (valido) expect(() => validarParcelas(valor)).not.toThrow();
      else {
        expect(() => validarParcelas(valor)).toThrow(CalculoError);
        expect(() => validarParcelas(valor)).toThrow(/CALC_PARCELAS_INVALIDAS/);
      }
    });
    it('gera detalhes de parcelas inválidas', () =>
      expect(() => validarParcelas(7)).toThrow('2..6 inteiras esperado'));
  });

  describe('validarDataISO', () => {
    const casos: CasoValidacao[] = [
      ['2025-12-31', true],
      ['2024-02-29', true],
      ['2023-12-01', true],
      ['2025-13-01', false],
      ['2025-00-01', false],
      ['2025-12-32', false],
      ['25-12-31', false],
      ['2025/12/31', false],
      ['2025-12-31T10:00', false],
      ['2025-12-31 ', false],
      ['', false],
      [null, false],
      [undefined, false],
      [123, false],
    ];
    it.each(casos)('valida valor %p', (valor, valido) => {
      if (valido) expect(() => validarDataISO(valor)).not.toThrow();
      else {
        expect(() => validarDataISO(valor)).toThrow(CalculoError);
        expect(() => validarDataISO(valor)).toThrow(/CALC_DATA_INVALIDA/);
      }
    });
    it('gera detalhes de data inválida', () =>
      expect(() => validarDataISO('2025/12/31')).toThrow('formato'));
  });

  describe('validarNumero', () => {
    const casos: CasoValidacao[] = [
      [1, true],
      [999, true],
      [0, false],
      [-1, false],
      [1.5, false],
      [NaN, false],
      ['1', false],
      [null, false],
      [undefined, false],
    ];
    it.each(casos)('valida valor %p', (valor, valido) => {
      if (valido) expect(() => validarNumero(valor)).not.toThrow();
      else {
        expect(() => validarNumero(valor)).toThrow(CalculoError);
        expect(() => validarNumero(valor)).toThrow(/CALC_NUMERO_INVALIDO/);
      }
    });
    it('gera detalhes de número inválido', () =>
      expect(() => validarNumero(0)).toThrow('inteiro >= 1 esperado'));
  });
});
