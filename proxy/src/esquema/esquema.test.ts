import { esquemaDoDicionario as esquema } from './esquema';

describe('esquema do dicionário de dados', () => {
  it('conhece as 22 tabelas do Sistema 2', () => {
    expect(esquema.tabelaExiste('orcamento')).toBe(true);
    expect(esquema.tabelaExiste('pedido')).toBe(true);
    expect(esquema.tabelaExiste('tabela_inexistente')).toBe(false);
  });

  it('valida colunas e chaves primárias', () => {
    expect(esquema.temColuna('operador', 'senha_hash')).toBe(true);
    expect(esquema.temColuna('operador', 'nao_existe')).toBe(false);
    expect(esquema.chavePrimaria('pedido')).toEqual(['id_pedido']);
  });

  it('descobre a ligação por FK nos dois sentidos', () => {
    const [filha] = esquema.relacoes('pedido', 'item_pedido');
    expect(filha).toMatchObject({
      tabelaFilha: 'item_pedido',
      tabelaPai: 'pedido',
      colunaFilha: 'id_pedido',
    });
    expect(esquema.relacoes('item_pedido', 'pedido')).toHaveLength(
      esquema.relacoes('pedido', 'item_pedido').length,
    );
    expect(esquema.relacoes('pedido', 'fardo')).toEqual([]);
  });
});
