import {
  centavosParaDecimal,
  ConversaoError,
  converterChavesParaCamelCase,
  converterChavesParaSnakeCase,
  decimalParaCentavos,
  paraCamelCase,
  paraSnakeCase,
} from './conversao';

describe('decimalParaCentavos', () => {
  it.each([
    ['12.34', 1234],
    ['5', 500],
    ['0.5', 50],
    ['0.05', 5],
    ['0', 0],
    ['0.00', 0],
    ['-0.00', 0],
    ['-12.34', -1234],
    ['1500.00', 150000],
    ['9999999999.99', 999999999999],
    ['0.29', 29],
    ['1.15', 115],
  ])('%s → %i', (texto, centavos) => {
    expect(decimalParaCentavos(texto)).toBe(centavos);
  });

  it.each(['', 'abc', '12,34', '12.345', '1e3', ' 12.34', '.5', '12.', '99999999999999999999'])(
    'recusa "%s"',
    (texto) => {
      expect(() => decimalParaCentavos(texto)).toThrow(ConversaoError);
    },
  );
});

describe('centavosParaDecimal', () => {
  it.each([
    [1234, '12.34'],
    [500, '5.00'],
    [50, '0.50'],
    [5, '0.05'],
    [0, '0.00'],
    [-1234, '-12.34'],
    [-5, '-0.05'],
    [150000, '1500.00'],
  ])('%i → %s', (centavos, texto) => {
    expect(centavosParaDecimal(centavos)).toBe(texto);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY])('recusa %p', (valor) => {
    expect(() => centavosParaDecimal(valor)).toThrow(ConversaoError);
  });

  it.each([0, 1, 29, 115, 49999, 150000, -1])('ida e volta preserva %i', (centavos) => {
    expect(decimalParaCentavos(centavosParaDecimal(centavos))).toBe(centavos);
  });
});

describe('nomes de chaves', () => {
  it.each([
    ['preco_unitario_aplicado', 'precoUnitarioAplicado'],
    ['id_cliente', 'idCliente'],
    ['status', 'status'],
    ['precoUnitario', 'precoUnitario'],
    ['endereco_2', 'endereco2'],
  ])('paraCamelCase: %s → %s', (entrada, saida) => {
    expect(paraCamelCase(entrada)).toBe(saida);
  });

  it.each([
    ['precoUnitarioAplicado', 'preco_unitario_aplicado'],
    ['idCliente', 'id_cliente'],
    ['status', 'status'],
    ['preco_unitario', 'preco_unitario'],
  ])('paraSnakeCase: %s → %s', (entrada, saida) => {
    expect(paraSnakeCase(entrada)).toBe(saida);
  });
});

describe('conversão de chaves em profundidade', () => {
  const data = new Date('2026-11-10T00:00:00Z');
  const EM_SNAKE = {
    id_pedido: 7,
    valor_total_proposta: '12.34',
    data_registro: data,
    motivo_negativa: null,
    item_pedido: [{ id_item: 1, quantidade_solicitada: 2 }],
    cliente: { razao_social: 'Mercearia A' },
  };
  const EM_CAMEL = {
    idPedido: 7,
    valorTotalProposta: '12.34',
    dataRegistro: data,
    motivoNegativa: null,
    itemPedido: [{ idItem: 1, quantidadeSolicitada: 2 }],
    cliente: { razaoSocial: 'Mercearia A' },
  };

  it('converte para camelCase sem tocar nos valores', () => {
    expect(converterChavesParaCamelCase(EM_SNAKE)).toEqual(EM_CAMEL);
  });

  it('converte para snake_case sem tocar nos valores', () => {
    expect(converterChavesParaSnakeCase(EM_CAMEL)).toEqual(EM_SNAKE);
  });

  it('não altera o objeto original', () => {
    const original = { id_pedido: 1 };

    converterChavesParaCamelCase(original);

    expect(original).toEqual({ id_pedido: 1 });
  });

  it.each([['texto_solto'], [42], [null], [undefined]])('devolve %p como está', (valor) => {
    expect(converterChavesParaCamelCase(valor)).toBe(valor);
  });
});
