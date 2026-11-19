import { api, ApiError, definirToken } from './client';
import {
  configurarFila,
  descartarItem,
  esperaDaTentativa,
  itemComFalha,
  LIMITE_CHAMADA_MS,
  MAX_TENTATIVAS,
  tentarNovamente,
  type ItemFila,
  itensPendentes,
  limparFila,
  processarFila,
  quantidadePendente,
  reiniciarFilaEmMemoria,
} from './filaOffline';

jest.mock('../config', () => ({ API_URL: 'http://api.teste' }));

function resposta(status: number, corpo?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      corpo === undefined ? Promise.reject(new Error('sem corpo')) : Promise.resolve(corpo),
  } as Response;
}

function armazenamentoFalso(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('fila offline (RNF06)', () => {
  const fetchMock = jest.fn();
  const reler = jest.fn();
  const descartado = jest.fn();
  const SEM_REDE = new TypeError('Failed to fetch');

  beforeEach(() => {
    fetchMock.mockReset();
    reler.mockReset();
    descartado.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    (globalThis as { localStorage?: Storage }).localStorage = armazenamentoFalso();
    reiniciarFilaEmMemoria();
    definirToken('tok-secreto-zzz');
    configurarFila({ reler, descartado });
  });

  it('envia Idempotency-Key nas mutações de orçamento e não nas leituras nem no upload', async () => {
    fetchMock.mockResolvedValue(resposta(200, {}));
    await api.post('/orcamentos/1/itens', { a: 1 });
    await api.get('/orcamentos/1');
    await api.upload('/orcamentos/1/anexos', new FormData());
    await api.post('/pedidos/1/negar', {});
    const chaves = fetchMock.mock.calls.map(([, i]) => i.headers['Idempotency-Key']);
    expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(chaves.slice(1)).toEqual([undefined, undefined, undefined]);
  });

  it('sem rede guarda na fila; reenvio ordenado reutiliza a chave e relê antes de descartar', async () => {
    fetchMock.mockRejectedValue(SEM_REDE);
    await expect(api.post('/orcamentos/1/itens', { n: 1 })).rejects.toMatchObject({
      codigo: 'ENFILEIRADA',
    });
    await expect(api.patch('/orcamentos/1/itens/2', { quantidade: 5 })).rejects.toBeInstanceOf(
      ApiError,
    );
    const [a, b] = itensPendentes() as [ItemFila, ItemFila];
    expect(quantidadePendente()).toBe(2);
    const chaveInicial = fetchMock.mock.calls[0]![1].headers['Idempotency-Key'];
    expect(a.chave).toBe(chaveInicial);

    fetchMock.mockReset();
    const ordem: string[] = [];
    fetchMock.mockImplementation(async (_u, init) => {
      ordem.push(`${init.method}:${init.headers['Idempotency-Key']}`);
      return resposta(200, {});
    });
    reler.mockImplementation(() => {
      ordem.push('reler');
    });
    await processarFila();
    expect(ordem).toEqual([`POST:${a.chave}`, 'reler', `PATCH:${b.chave}`, 'reler']);
    expect(quantidadePendente()).toBe(0);
  });

  it('mantém a ordem: com itens na fila, nova mutação entra atrás sem ir à rede', async () => {
    fetchMock.mockRejectedValue(SEM_REDE);
    await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(SEM_REDE);
    await api.delete('/orcamentos/1/itens/9').catch(() => undefined);
    expect(quantidadePendente()).toBe(2);
    expect(itensPendentes()[1]!.metodo).toBe('DELETE');
  });

  it('para no erro de rede e mantém o item; reenvia depois com a mesma chave', async () => {
    fetchMock.mockRejectedValue(SEM_REDE);
    await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
    const chave = itensPendentes()[0]!.chave;
    await processarFila();
    expect(quantidadePendente()).toBe(1);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resposta(200, {}));
    await processarFila();
    expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe(chave);
    expect(quantidadePendente()).toBe(0);
  });

  it('descarta e avisa em 4xx definitivo, seguindo para o próximo', async () => {
    fetchMock.mockRejectedValue(SEM_REDE);
    await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
    await api.post('/orcamentos/1/emitir').catch(() => undefined);
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(
        resposta(422, { codigo: 'ESTOQUE_INDISPONIVEL', mensagem: 'Sem saldo' }),
      )
      .mockResolvedValueOnce(resposta(200, {}));
    await processarFila();
    expect(descartado).toHaveBeenCalledTimes(1);
    expect(descartado.mock.calls[0]![1].codigo).toBe('ESTOQUE_INDISPONIVEL');
    expect(quantidadePendente()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mantém o item em 5xx', async () => {
    fetchMock.mockRejectedValue(SEM_REDE);
    await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(resposta(503, { codigo: 'ESTOQUE_TIMEOUT', mensagem: 'x' }));
    await processarFila();
    expect(quantidadePendente()).toBe(1);
    expect(descartado).not.toHaveBeenCalled();
  });

  it('não enfileira criação de orçamento nem erro HTTP; persiste e limpa no logout', async () => {
    fetchMock.mockRejectedValue(SEM_REDE);
    await expect(api.post('/orcamentos', {})).rejects.toMatchObject({ codigo: 'SEM_CONEXAO' });
    expect(quantidadePendente()).toBe(0);
    fetchMock.mockResolvedValue(resposta(422, { codigo: 'X', mensagem: 'm' }));
    await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
    expect(quantidadePendente()).toBe(0);

    fetchMock.mockRejectedValue(SEM_REDE);
    await api.post('/orcamentos/1/itens', { n: 1 }).catch(() => undefined);
    const salvo = localStorage.getItem('suprimax.fila')!;
    expect(salvo).toContain('/orcamentos/1/itens');
    expect(salvo).not.toContain('tok-secreto-zzz'); // o token nunca vai para o armazenamento
    reiniciarFilaEmMemoria();
    expect(quantidadePendente()).toBe(1); // recarregou do armazenamento
    limparFila();
    expect(quantidadePendente()).toBe(0);
    expect(localStorage.getItem('suprimax.fila')).toBeNull();
  });

  it('funciona sem armazenamento disponível', async () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    reiniciarFilaEmMemoria();
    fetchMock.mockRejectedValue(SEM_REDE);
    await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
    expect(quantidadePendente()).toBe(1);
  });

  describe('travamento, limite de tentativas e mutação offline', () => {
    afterEach(() => jest.useRealTimers());

    it('chamada pendurada não segura a fila: expira e o reenvio seguinte funciona na mesma sessão', async () => {
      jest.useFakeTimers();
      fetchMock.mockRejectedValue(SEM_REDE);
      await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      // a rede "volta", mas a conexão do reenvio fica pendurada (nunca responde)
      fetchMock.mockReset();
      fetchMock.mockImplementation(() => new Promise(() => undefined));
      const preso = processarFila();
      await jest.advanceTimersByTimeAsync(LIMITE_CHAMADA_MS + 1);
      await preso; // sem o prazo, esta promessa nunca resolveria e processando ficaria preso
      expect(quantidadePendente()).toBe(1);
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(resposta(200, {}));
      await processarFila();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(quantidadePendente()).toBe(0);
    });

    it('releitura travada não segura a fila e o item (já enviado) não é reenviado', async () => {
      jest.useFakeTimers();
      fetchMock.mockRejectedValue(SEM_REDE);
      await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(resposta(200, {}));
      reler.mockReturnValueOnce(new Promise(() => undefined));
      const preso = processarFila();
      await jest.advanceTimersByTimeAsync(LIMITE_CHAMADA_MS + 1);
      await preso;
      expect(quantidadePendente()).toBe(1);
      reler.mockReturnValue(undefined);
      await processarFila();
      expect(fetchMock).toHaveBeenCalledTimes(1); // só a releitura repetiu
      expect(quantidadePendente()).toBe(0);
    });

    it('503 repetido: espera crescente, limite de tentativas e falha sem perder o item', async () => {
      jest.useFakeTimers();
      fetchMock.mockRejectedValue(SEM_REDE);
      await api.post('/orcamentos/1/enviar').catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(resposta(503, { codigo: 'SERVICO_INDISPONIVEL', mensagem: 'x' }));
      await processarFila();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(itensPendentes()[0]!.tentativas).toBe(1);
      await processarFila(); // ainda em espera: não vai à rede
      expect(fetchMock).toHaveBeenCalledTimes(1);
      for (let n = 2; n <= MAX_TENTATIVAS; n++) {
        jest.advanceTimersByTime(esperaDaTentativa(n - 1) + 1);
        await processarFila();
      }
      expect(fetchMock).toHaveBeenCalledTimes(MAX_TENTATIVAS);
      expect(quantidadePendente()).toBe(1);
      expect(itemComFalha()?.chave).toBe(itensPendentes()[0]!.chave);
      expect(esperaDaTentativa(2)).toBe(2 * esperaDaTentativa(1));
      // parada: nem o timer nem o evento online reenviam
      jest.advanceTimersByTime(60 * 60_000);
      await processarFila({ ignorarEspera: true });
      expect(fetchMock).toHaveBeenCalledTimes(MAX_TENTATIVAS);
    });

    it('tentar de novo reenvia com a mesma chave; descartar libera a fila', async () => {
      fetchMock.mockRejectedValue(SEM_REDE);
      await api.post('/orcamentos/1/enviar').catch(() => undefined);
      await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
      const [a] = itensPendentes() as [ItemFila, ItemFila];
      a.falhou = true;
      a.tentativas = MAX_TENTATIVAS;
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(resposta(200, {}));
      await processarFila();
      expect(fetchMock).not.toHaveBeenCalled(); // bloqueada em ordem
      tentarNovamente(a.chave);
      await processarFila();
      expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe(a.chave);
      expect(quantidadePendente()).toBe(0);

      fetchMock.mockReset();
      fetchMock.mockRejectedValue(SEM_REDE);
      await api.post('/orcamentos/1/enviar').catch(() => undefined);
      itensPendentes()[0]!.falhou = true;
      descartarItem(itensPendentes()[0]!.chave);
      expect(quantidadePendente()).toBe(0);
    });

    it('erro de rede com onLine verdadeiro não conta como falha do servidor', async () => {
      fetchMock.mockRejectedValue(SEM_REDE);
      await api.post('/orcamentos/1/itens', {}).catch(() => undefined);
      for (let n = 0; n < MAX_TENTATIVAS + 2; n++) await processarFila();
      expect(itensPendentes()[0]!.falhou).toBeFalsy();
      expect(itensPendentes()[0]!.tentativas).toBeUndefined();
    });

    it('mutação fora de orçamento existente não entra na fila (só falha com aviso)', async () => {
      fetchMock.mockRejectedValue(SEM_REDE);
      await expect(api.post('/pedidos/1/negar', {})).rejects.toMatchObject({
        codigo: 'SEM_CONEXAO',
      });
      await expect(api.post('/clientes', {})).rejects.toMatchObject({ codigo: 'SEM_CONEXAO' });
      expect(quantidadePendente()).toBe(0);
    });
  });
});
