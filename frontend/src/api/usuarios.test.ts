import { definirToken } from './client';
import { usuariosApi } from './usuarios';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

describe('usuariosApi (UC25)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken('abc');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ idOperador: 7, email: 'novo@suprimax.com.br' }),
    } as Response);
  });

  it('atualizar envia o novo e-mail em PATCH /usuarios/:id', async () => {
    await usuariosApi.atualizar(7, { email: 'novo@suprimax.com.br' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.teste/usuarios/7');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'novo@suprimax.com.br' });
  });
});
