import { AppError, CATALOGO_ERROS, corpoDoErro } from './erros';

describe('AppError', () => {
  it('usa status e mensagem do catálogo (12.8.6)', () => {
    const e = new AppError('PEDIDO_JA_ASSUMIDO');
    expect(e.status).toBe(409);
    expect(corpoDoErro(e)).toEqual({
      ok: false,
      erro: { codigo: 'PEDIDO_JA_ASSUMIDO', mensagem: CATALOGO_ERROS.PEDIDO_JA_ASSUMIDO.mensagem },
    });
  });

  it('não expõe o motivo interno ao cliente', () => {
    const e = new AppError('INTERNAL_ERROR', undefined, 'relation "pedido" does not exist');
    expect(JSON.stringify(corpoDoErro(e))).not.toContain('pedido');
  });

  it('inclui detalhes seguros quando informados', () => {
    const e = new AppError('ESTOQUE_INSUFICIENTE', {
      produto: 'Arroz 5 kg',
      disponivel: 2,
      quantidade: 5,
    });
    expect(corpoDoErro(e).erro.detalhes).toEqual({
      produto: 'Arroz 5 kg',
      disponivel: 2,
      quantidade: 5,
    });
  });

  it.each([
    ['PAYLOAD_INVALIDO', 400],
    ['TOKEN_INVALIDO', 401],
    ['ESCOPO_NEGADO', 403],
    ['OPERACAO_DESCONHECIDA', 404],
    ['RISCO_ESTRUTURAL', 422],
    ['LIMITE_EXCEDIDO', 429],
  ] as const)('%s -> HTTP %d', (codigo, status) => {
    expect(new AppError(codigo).status).toBe(status);
  });
});
