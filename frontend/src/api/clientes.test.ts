import { definirToken } from './client';
import { clientesApi } from './clientes';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

describe('clientesApi (UC02, UC03)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken('abc');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ clientes: [], pagina: 1, tamanho: 20, temMais: false }),
    } as Response);
  });

  it('listar envia q, status, pagina e tamanho na query e omite o que está vazio', async () => {
    await clientesApi.listar({ q: 'alfa', status: 'ATIVO', pagina: 2, tamanho: 20 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.teste/clientes?q=alfa&status=ATIVO&pagina=2&tamanho=20');

    fetchMock.mockClear();
    await clientesApi.listar({ q: '', status: undefined });
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.teste/clientes');
  });

  it('adicionarEndereco faz POST em /clientes/:id/enderecos com o endereço no corpo', async () => {
    const endereco = {
      tipo: 'ENTREGA' as const,
      logradouro: 'Rua 7',
      numero: '45',
      complemento: null,
      bairro: 'Centro',
      cidade: 'Goiânia',
      uf: 'GO',
      cep: '74000100',
    };
    await clientesApi.adicionarEndereco(3, endereco);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.teste/clientes/3/enderecos');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(endereco));
  });
});
