import { api, ApiError, definirToken } from './client';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

function resposta(status: number, corpo?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      corpo === undefined ? Promise.reject(new Error('sem corpo')) : Promise.resolve(corpo),
  } as Response;
}

describe('cliente HTTP', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken(null);
  });

  it('monta a URL com query, ignorando valores vazios', async () => {
    fetchMock.mockResolvedValue(resposta(200, []));
    await api.get('/orcamentos', { query: { status: 'ABERTO', cliente: '', numero: undefined } });
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.teste/orcamentos?status=ABERTO');
  });

  it('envia o token como Bearer e o corpo como JSON', async () => {
    definirToken('abc');
    fetchMock.mockResolvedValue(resposta(200, { ok: true }));
    await api.post('/pedidos/1/negar', { motivo: 'Sem estoque' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer abc');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ motivo: 'Sem estoque' }));
  });

  it('converte o erro do backend em ApiError', async () => {
    fetchMock.mockResolvedValue(
      resposta(409, { codigo: 'PEDIDO_JA_ASSUMIDO', mensagem: 'Outro operador assumiu.' }),
    );
    await expect(api.post('/pedidos/1/assumir')).rejects.toMatchObject({
      status: 409,
      codigo: 'PEDIDO_JA_ASSUMIDO',
      message: 'Outro operador assumiu.',
    });
  });

  it('trata queda de conexão como SEM_CONEXAO', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const erro = (await api.get('/pedidos').catch((e: unknown) => e)) as ApiError;
    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.semConexao).toBe(true);
  });

  it('204 devolve undefined', async () => {
    fetchMock.mockResolvedValue(resposta(204));
    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });
});
