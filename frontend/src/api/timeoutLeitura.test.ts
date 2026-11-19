import { api, definirToken } from './client';
import { assinarLentidao, haLeituraLenta } from './lentidao';
import { AVISO_LENTIDAO_MS, LIMITE_LEITURA_MS } from './lentidao';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

/** fetch que nunca responde, mas obedece ao `signal` como o do navegador. */
function fetchPendurado(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, rejeitar) => {
    init.signal?.addEventListener('abort', () =>
      rejeitar(new DOMException('Aborted', 'AbortError')),
    );
  });
}

describe('prazo das leituras (RNF06)', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    definirToken(null);
  });
  afterEach(() => jest.useRealTimers());

  it('avisa aos 15 s e vira "Sem conexão" aos 60 s, sem deixar o aviso preso', async () => {
    fetchMock.mockImplementation(fetchPendurado);
    const avisos = jest.fn();
    const cancelar = assinarLentidao(avisos);
    const chamada = api.get('/clientes');
    const resultado = chamada.catch((e: unknown) => e);

    jest.advanceTimersByTime(AVISO_LENTIDAO_MS - 1);
    expect(haLeituraLenta()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(haLeituraLenta()).toBe(true);

    jest.advanceTimersByTime(LIMITE_LEITURA_MS - AVISO_LENTIDAO_MS);
    expect(await resultado).toMatchObject({
      status: 0,
      codigo: 'SEM_CONEXAO',
      message: 'Sem conexão com o servidor. Tente novamente.',
    });
    expect(haLeituraLenta()).toBe(false);
    cancelar();
  });

  it('resposta antes dos prazos cancela os temporizadores', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([1]) });
    await expect(api.get('/clientes')).resolves.toEqual([1]);
    jest.advanceTimersByTime(LIMITE_LEITURA_MS);
    expect(haLeituraLenta()).toBe(false);
  });

  it('gravação não tem prazo: segue pendente além de 60 s e sem signal', async () => {
    let sinal: AbortSignal | undefined;
    fetchMock.mockImplementation((_u: string, init: RequestInit) => {
      sinal = init.signal ?? undefined;
      return new Promise(() => undefined);
    });
    void api.post('/clientes', { a: 1 });
    jest.advanceTimersByTime(LIMITE_LEITURA_MS * 2);
    expect(sinal).toBeUndefined();
    expect(haLeituraLenta()).toBe(false);
  });

  it('cancelamento do chamador continua sendo AbortError', async () => {
    fetchMock.mockImplementation(fetchPendurado);
    const controle = new AbortController();
    const resultado = api.get('/clientes', { signal: controle.signal }).catch((e: unknown) => e);
    controle.abort();
    expect(await resultado).toMatchObject({ name: 'AbortError' });
  });
});
