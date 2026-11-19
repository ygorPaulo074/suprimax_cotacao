import { definirToken } from './client';
import { orcamentosApi } from './orcamentos';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

describe('orcamentosApi.criar (UC14)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken('abc');
  });

  it('faz POST /orcamentos com o idCliente e devolve o detalhe do rascunho', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ idOrcamento: 7, status: 'RASCUNHO' }),
    } as Response);
    const detalhe = await orcamentosApi.criar({ idCliente: 3 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.teste/orcamentos');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ idCliente: 3 }));
    expect(detalhe.idOrcamento).toBe(7);
  });
});

describe('orcamentosApi.listarPagina (UC01)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken('abc');
  });

  it('pede GET /orcamentos com limite e depois e devolve a página', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ itens: [], temMais: false, proximo: null }),
    } as Response);
    const pagina = await orcamentosApi.listarPagina(
      { status: 'ABERTO' },
      { limite: 20, depois: 9 },
    );
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.teste/orcamentos?status=ABERTO&limite=20&depois=9');
    expect(pagina).toEqual({ itens: [], temMais: false, proximo: null });
  });

  it('manda o limite padrão na primeira página', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ itens: [], temMais: false, proximo: null }),
    } as Response);
    await orcamentosApi.listarPagina();
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.teste/orcamentos?limite=50');
  });
});
