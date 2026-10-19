import { formatarBRL, reaisParaCentavos } from './dinheiro';

describe('formatarBRL', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [22420, 'R$ 224,20'],
    [118000, 'R$ 1.180,00'],
    [123456789, 'R$ 1.234.567,89'],
    [-1050, '-R$ 10,50'],
  ])('%d centavos -> %s', (centavos, esperado) => {
    expect(formatarBRL(centavos)).toBe(esperado);
  });

  it('mostra travessão quando não há valor', () => {
    expect(formatarBRL(null)).toBe('—');
    expect(formatarBRL(undefined)).toBe('—');
    expect(formatarBRL(NaN)).toBe('—');
  });
});

describe('reaisParaCentavos', () => {
  it.each([
    ['19', 1900],
    ['19,5', 1950],
    ['19,50', 1950],
    ['1.234,56', 123456],
    ['R$ 47,50', 4750],
    ['0,05', 5],
  ])('%s -> %d', (texto, esperado) => {
    expect(reaisParaCentavos(texto)).toBe(esperado);
  });

  it.each(['', 'abc', '1,234', '-5', '1,2,3'])('rejeita "%s"', (texto) => {
    expect(reaisParaCentavos(texto)).toBeNull();
  });
});
