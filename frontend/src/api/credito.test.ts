import { definirToken } from './client';
import { creditoApi, validarArquivoDeCredito } from './credito';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

describe('creditoApi (UC07)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken('abc');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ idAnalise: 5 }),
    } as Response);
  });

  it('sem arquivo envia JSON (recebido em meio físico)', async () => {
    await creditoApi.registrarDocumento(5, 'CONTRATO_SOCIAL', '2026-11-17');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.teste/analises-credito/5/documentos');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(
      JSON.stringify({ tipoDocumento: 'CONTRATO_SOCIAL', dataRecebimento: '2026-11-17' }),
    );
  });

  it('com arquivo envia multipart com tipoDocumento, dataRecebimento e arquivo', async () => {
    const arquivo = new File(['x'], 'contrato.pdf', { type: 'application/pdf' });
    await creditoApi.registrarDocumento(5, 'CONTRATO_SOCIAL', '2026-11-17', arquivo);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body.get('tipoDocumento')).toBe('CONTRATO_SOCIAL');
    expect(init.body.get('dataRecebimento')).toBe('2026-11-17');
    expect((init.body.get('arquivo') as File).name).toBe('contrato.pdf');
  });

  it('busca a URL assinada do documento', async () => {
    await creditoApi.urlDoDocumento(5, 'BALANCO_LUCRO');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://api.teste/analises-credito/5/documentos/BALANCO_LUCRO/arquivo',
    );
  });
});

describe('validarArquivoDeCredito', () => {
  it('aceita PDF, JPEG e PNG até 10 MB', () => {
    for (const tipo of ['application/pdf', 'image/jpeg', 'image/png'])
      expect(validarArquivoDeCredito(new File(['x'], 'a', { type: tipo }))).toBeNull();
  });
  it('recusa tipo não aceito', () => {
    expect(validarArquivoDeCredito(new File(['x'], 'a.txt', { type: 'text/plain' }))).toMatch(
      /Formato/,
    );
  });
  it('recusa arquivo acima de 10 MB', () => {
    const grande = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    Object.defineProperty(grande, 'size', { value: 10 * 1024 * 1024 + 1 });
    expect(validarArquivoDeCredito(grande)).toMatch(/10 MB/);
  });
});
