import { ehFreteFob } from './opcoes';

describe('ehFreteFob', () => {
  it.each([
    ['FOB', 200000, true],
    ['CIF', 10000, false],
    [null, 149999, true],
    [null, 150000, false],
    [null, 0, true],
  ] as const)('modalidade %s, itens %i: %s', (modalidade, total, esperado) => {
    expect(ehFreteFob(modalidade, total)).toBe(esperado);
  });
});
