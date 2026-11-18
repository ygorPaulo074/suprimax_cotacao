import { numeroDoPedido } from './numero';

describe('numeroDoPedido', () => {
  it('formata com prefixo e quatro dígitos', () => {
    expect(numeroDoPedido(9)).toBe('PED-0009');
    expect(numeroDoPedido(123)).toBe('PED-0123');
  });

  it('não trunca ids acima de 9999', () => {
    expect(numeroDoPedido(12345)).toBe('PED-12345');
  });
});
