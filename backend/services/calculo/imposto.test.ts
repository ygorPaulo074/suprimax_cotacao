import { calcularImpostoItem } from './imposto';
import { CalculoError } from './erros';

describe('calcularImpostoItem', () => {
  // Tabela de casos da documentação (seção 11.6.3.3). Valores em centavos.
  it.each([
    {
      nome: '10 un. x R$ 100,00',
      quantidade: 10,
      preco: 10000,
      linha: 100000,
      imposto: 18000,
      total: 118000,
    },
    {
      nome: '10 un. x R$ 10,55',
      quantidade: 10,
      preco: 1055,
      linha: 10550,
      imposto: 1899,
      total: 12449,
    },
    {
      nome: '2 fardos x R$ 47,50',
      quantidade: 2,
      preco: 4750,
      linha: 9500,
      imposto: 1710,
      total: 11210,
    },
    { nome: '3 x R$ 1,05', quantidade: 3, preco: 105, linha: 315, imposto: 57, total: 372 },
    { nome: '7 x R$ 3,33', quantidade: 7, preco: 333, linha: 2331, imposto: 420, total: 2751 },
    {
      nome: '1.000 un. x R$ 1,05 (por linha, não por unidade)',
      quantidade: 1000,
      preco: 105,
      linha: 105000,
      imposto: 18900,
      total: 123900,
    },
    { nome: 'preço zero', quantidade: 1, preco: 0, linha: 0, imposto: 0, total: 0 },
  ])('$nome', ({ quantidade, preco, linha, imposto, total }) => {
    expect(calcularImpostoItem({ quantidade, precoUnitarioAplicado: preco })).toEqual({
      valorLinha: linha,
      imposto,
      totalItem: total,
    });
  });

  it('soma dos impostos das linhas pode diferir 1 centavo de 18% do total', () => {
    const a = calcularImpostoItem({ quantidade: 3, precoUnitarioAplicado: 105 });
    const b = calcularImpostoItem({ quantidade: 7, precoUnitarioAplicado: 333 });
    expect(a.imposto + b.imposto).toBe(477); // R$ 4,77, e não R$ 4,76
  });

  it.each([
    ['quantidade', { quantidade: 0, precoUnitarioAplicado: 100 }],
    ['quantidade', { quantidade: -1, precoUnitarioAplicado: 100 }],
    ['quantidade', { quantidade: 1.5, precoUnitarioAplicado: 100 }],
    ['precoUnitarioAplicado', { quantidade: 1, precoUnitarioAplicado: -1 }],
    ['precoUnitarioAplicado', { quantidade: 1, precoUnitarioAplicado: 10.5 }],
    ['precoUnitarioAplicado', { quantidade: 1, precoUnitarioAplicado: NaN }],
  ])('rejeita entrada inválida em %s', (campo, entrada) => {
    let erro: unknown;
    try {
      calcularImpostoItem(entrada);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(CalculoError);
    expect(erro).toMatchObject({ codigo: 'CALC_ENTRADA_INVALIDA', campo });
  });
});
