import type { Config } from '../config';
import { ErroDeServicoIndisponivel, ErroDeValidacao, ErroInterno } from '../erros';
import { criarLogger } from '../log';
import {
  ClienteProxy,
  ErroProxy,
  ProxyNaoConfiguradoError,
  type OpcoesDoClienteProxy,
} from './proxyCliente';

// Os testes trocam o `fetch` por uma função simulada (opção `fetch` do cliente): sem rede.
const CONFIG = { url: 'https://proxy.teste', serviceId: 'sistema2-backend', token: 'tok-123' };
const AGORA = new Date('2026-11-10T12:00:00.000Z');
const SUCESSO = { ok: true, afetados: 1 };

type FetchSimulado = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

function resposta(status: number, corpo: unknown): Response {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status });
}

function erroDoProxy(status: number, codigo: string, detalhes?: Record<string, unknown>): Response {
  return resposta(status, { ok: false, erro: { codigo, mensagem: `proxy: ${codigo}`, detalhes } });
}

/** Cria um `fetch` simulado que devolve os resultados na ordem; um Error é lançado. */
function fetchQueDevolve(...resultados: (Response | Error)[]): FetchSimulado {
  const simulado: FetchSimulado = jest.fn();
  for (const resultado of resultados) {
    if (resultado instanceof Error) {
      simulado.mockRejectedValueOnce(resultado);
    } else {
      simulado.mockResolvedValueOnce(resultado);
    }
  }
  return simulado;
}

function montar(fetchSimulado: FetchSimulado, opcoes: OpcoesDoClienteProxy = {}) {
  const linhas: string[] = [];
  const logger = criarLogger({ nivel: 'info', destino: { write: (l) => void linhas.push(l) } });
  const esperar = jest.fn(async () => undefined);
  const cliente = new ClienteProxy(CONFIG, logger, {
    fetch: fetchSimulado,
    esperar,
    agora: () => AGORA,
    ...opcoes,
  });
  return { cliente, esperar, linhas };
}

function cabecalhosDaChamada(fetchSimulado: FetchSimulado, indice: number): Record<string, string> {
  return fetchSimulado.mock.calls[indice]?.[1]?.headers as Record<string, string>;
}

async function capturar(promessa: Promise<unknown>): Promise<unknown> {
  return promessa.then(
    () => {
      throw new Error('a chamada deveria ter falhado');
    },
    (erro: unknown) => erro,
  );
}

describe('ClienteProxy.executar — requisição', () => {
  it('envia POST /executar com o envelope e os cabeçalhos do proxy', async () => {
    const fetchSimulado = fetchQueDevolve(resposta(200, SUCESSO));
    const payload = { tabela: 'pedido', filtros: { e: [['status', '=', 'SOLICITADO']] } };

    await montar(fetchSimulado).cliente.executar('dados.consultar', payload, 'UC10-listar');

    const [url, requisicao] = fetchSimulado.mock.calls[0] ?? [];
    expect(url).toBe('https://proxy.teste/executar');
    expect(requisicao?.method).toBe('POST');
    expect(JSON.parse(String(requisicao?.body))).toEqual({ operacao: 'dados.consultar', payload });
    expect(requisicao?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok-123',
      'X-Service-Id': 'sistema2-backend',
      'X-Timestamp': '2026-11-10T12:00:00.000Z',
      'X-Operation-Id': 'UC10-listar',
    });
  });

  it('gera um X-Timestamp novo a cada chamada, mesmo dentro do mesmo milissegundo', async () => {
    const fetchSimulado = fetchQueDevolve(resposta(200, SUCESSO), resposta(200, SUCESSO));
    const { cliente } = montar(fetchSimulado);

    await cliente.executar('dados.inserir', { tabela: 'cliente' }, 'UC02');
    await cliente.executar('dados.inserir', { tabela: 'cliente' }, 'UC02');

    expect(cabecalhosDaChamada(fetchSimulado, 0)['X-Timestamp']).toBe('2026-11-10T12:00:00.000Z');
    expect(cabecalhosDaChamada(fetchSimulado, 1)['X-Timestamp']).toBe('2026-11-10T12:00:00.001Z');
  });
});

describe('ClienteProxy.executar — sucesso', () => {
  it('devolve o corpo com as chaves em camelCase e os valores como vieram', async () => {
    const corpo = {
      ok: true,
      dados: [{ id_pedido: 7, valor_total: '12.34', item_pedido: [{ id_item: 1 }] }],
      proximo_cursor: null,
    };
    const { cliente } = montar(fetchQueDevolve(resposta(200, corpo)));

    expect(await cliente.executar('dados.consultar', { tabela: 'pedido' }, 'UC10')).toEqual({
      ok: true,
      dados: [{ idPedido: 7, valorTotal: '12.34', itemPedido: [{ idItem: 1 }] }],
      proximoCursor: null,
    });
  });

  it('em dados.lote, preserva os ids dos passos e converte o retorno de cada um', async () => {
    const corpo = { ok: true, resultados: { passo_1: { dados: [{ id_orcamento: 3 }] } } };
    const { cliente } = montar(fetchQueDevolve(resposta(200, corpo)));

    expect(await cliente.executar('dados.lote', { passos: [] }, 'UC01')).toEqual({
      ok: true,
      resultados: { passo_1: { dados: [{ idOrcamento: 3 }] } },
    });
  });
});

describe('ClienteProxy.executar — erros do proxy', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['PEDIDO_JA_ASSUMIDO', 409],
    ['ESTOQUE_INSUFICIENTE', 409],
    ['ORCAMENTO_NAO_EDITAVEL', 409],
    ['CHAVE_DUPLICADA', 409],
    ['RESPOSTA_JA_PROCESSADA', 409],
  ])('%s é repassado como ErroProxy, com status e detalhes', async (codigo, status) => {
    const fetchSimulado = fetchQueDevolve(erroDoProxy(status, codigo, { produto: 'Arroz 5 kg' }));

    const erro = await capturar(
      montar(fetchSimulado).cliente.executar('orcamento.emitir', { id_orcamento: 1 }, 'UC19'),
    );

    expect(erro).toBeInstanceOf(ErroProxy);
    expect(erro).toMatchObject({ status, codigo, detalhes: { produto: 'Arroz 5 kg' } });
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('PAYLOAD_INVALIDO vira ErroDeValidacao', async () => {
    const { cliente } = montar(fetchQueDevolve(erroDoProxy(400, 'PAYLOAD_INVALIDO')));

    const erro = await capturar(cliente.executar('dados.inserir', { tabela: 'x' }, 'UC02'));

    expect(erro).toBeInstanceOf(ErroDeValidacao);
    expect((erro as ErroDeValidacao).cause).toMatchObject({ codigo: 'PAYLOAD_INVALIDO' });
  });

  it.each([
    ['ESCOPO_NEGADO', 403],
    ['OPERACAO_DESCONHECIDA', 404],
    ['RISCO_ESTRUTURAL', 422],
  ])('%s vira ErroInterno e fica registrado no log', async (codigo, status) => {
    const { cliente, linhas } = montar(fetchQueDevolve(erroDoProxy(status, codigo)));

    const erro = await capturar(cliente.executar('dados.excluir', { tabela: 'x' }, 'UC05'));

    expect(erro).toBeInstanceOf(ErroInterno);
    expect(JSON.parse(linhas[0] ?? '')).toMatchObject({
      level: 'warn',
      operacao: 'dados.excluir',
      operationId: 'UC05',
      codigo,
      status,
    });
  });

  it.each([
    ['JSON fora do formato', resposta(200, { dados: [] })],
    ['erro sem código', resposta(500, { ok: false, erro: {} })],
    ['HTML com status 200', resposta(200, '<html>ok</html>')],
  ])('resposta inválida (%s) vira ErroInterno', async (_caso, respostaInvalida) => {
    const { cliente } = montar(fetchQueDevolve(respostaInvalida));

    const erro = await capturar(cliente.executar('dados.inserir', { tabela: 'x' }, 'UC02'));

    expect(erro).toBeInstanceOf(ErroInterno);
    expect((erro as ErroInterno).cause).toMatchObject({ codigo: 'RESPOSTA_INVALIDA' });
  });
});

describe('ClienteProxy.executar — TOKEN_INVALIDO', () => {
  it('repete uma vez com X-Timestamp novo, inclusive em gravação', async () => {
    const fetchSimulado = fetchQueDevolve(
      erroDoProxy(401, 'TOKEN_INVALIDO'),
      resposta(200, SUCESSO),
    );
    const { cliente, esperar } = montar(fetchSimulado);

    expect(await cliente.executar('dados.inserir', { tabela: 'cliente' }, 'UC02')).toEqual(SUCESSO);
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
    expect(cabecalhosDaChamada(fetchSimulado, 1)['X-Timestamp']).not.toBe(
      cabecalhosDaChamada(fetchSimulado, 0)['X-Timestamp'],
    );
    expect(esperar).not.toHaveBeenCalled();
  });

  it('desiste na segunda recusa e vira ErroInterno', async () => {
    const fetchSimulado = fetchQueDevolve(
      erroDoProxy(401, 'TOKEN_INVALIDO'),
      erroDoProxy(401, 'TOKEN_INVALIDO'),
    );

    const erro = await capturar(
      montar(fetchSimulado).cliente.executar('dados.consultar', { tabela: 'cliente' }, 'UC03'),
    );

    expect(erro).toBeInstanceOf(ErroInterno);
    expect(fetchSimulado).toHaveBeenCalledTimes(2);
  });
});

describe('ClienteProxy.executar — repetição de leitura', () => {
  const PRAZO_ESGOTADO = Object.assign(new Error('timeout'), { name: 'TimeoutError' });

  it.each([
    ['429', erroDoProxy(429, 'LIMITE_EXCEDIDO')],
    ['500', erroDoProxy(500, 'INTERNAL_ERROR')],
    ['falha de rede', new TypeError('fetch failed')],
    ['prazo esgotado', PRAZO_ESGOTADO],
  ])('repete dados.consultar após %s, com espera crescente', async (_caso, falha) => {
    const fetchSimulado = fetchQueDevolve(falha, falha, resposta(200, { ok: true, dados: [] }));
    const { cliente, esperar } = montar(fetchSimulado);

    expect(await cliente.executar('dados.consultar', { tabela: 'cliente' }, 'UC03')).toEqual({
      ok: true,
      dados: [],
    });
    expect(fetchSimulado).toHaveBeenCalledTimes(3);
    expect(esperar.mock.calls).toEqual([[200], [400]]);
    const timestamps = [0, 1, 2].map((i) => cabecalhosDaChamada(fetchSimulado, i)['X-Timestamp']);
    expect(new Set(timestamps).size).toBe(3);
  });

  it('desiste no limite de tentativas e vira serviço indisponível', async () => {
    const falha = new TypeError('fetch failed');
    const fetchSimulado = fetchQueDevolve(falha, falha, falha);

    const erro = await capturar(
      montar(fetchSimulado).cliente.executar('dados.consultar', { tabela: 'cliente' }, 'UC03'),
    );

    expect(erro).toBeInstanceOf(ErroDeServicoIndisponivel);
    expect((erro as ErroDeServicoIndisponivel).cause).toMatchObject({
      codigo: 'FALHA_DE_REDE',
      status: 503,
    });
    expect(fetchSimulado).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['dados.inserir'],
    ['dados.atualizar'],
    ['dados.excluir'],
    ['dados.lote'],
    ['dados.rpc'],
    ['pedido.assumir'],
    ['orcamento.emitir'],
    ['resposta.processar'],
  ])('nunca repete %s', async (operacao) => {
    const fetchSimulado = fetchQueDevolve(new TypeError('fetch failed'), resposta(200, SUCESSO));
    const { cliente, esperar } = montar(fetchSimulado);

    const erro = await capturar(cliente.executar(operacao, {}, 'UC'));

    expect(erro).toBeInstanceOf(ErroDeServicoIndisponivel);
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('interrompe a tentativa que passa do prazo', async () => {
    const fetchQueNuncaResponde: FetchSimulado = jest.fn(
      (_url, requisicao) =>
        new Promise<Response>((_resolve, reject) => {
          const sinal = requisicao?.signal;
          sinal?.addEventListener('abort', () => reject(sinal.reason as Error));
        }),
    );
    const { cliente } = montar(fetchQueNuncaResponde, { tempoLimiteMs: 20 });

    const erro = await capturar(cliente.executar('dados.inserir', {}, 'UC02'));

    expect(erro).toBeInstanceOf(ErroDeServicoIndisponivel);
    expect((erro as ErroDeServicoIndisponivel).cause).toMatchObject({
      codigo: 'TEMPO_ESGOTADO',
      status: 504,
    });
  });
});

describe('ClienteProxy — segredos', () => {
  it('não registra o token nem o corpo da requisição no log', async () => {
    const { cliente, linhas } = montar(fetchQueDevolve(erroDoProxy(403, 'ESCOPO_NEGADO')));

    await capturar(cliente.executar('dados.inserir', { valores: { senha: 'segredo-42' } }, 'UC25'));

    expect(linhas).toHaveLength(1);
    expect(linhas.join()).not.toContain('tok-123');
    expect(linhas.join()).not.toContain('segredo-42');
  });
});

describe('ClienteProxy.aPartirDaConfig', () => {
  const logger = criarLogger({ nivel: 'silent' });
  const COMPLETA: Pick<Config, 'proxyUrl' | 'proxyServiceId' | 'proxyServiceToken'> = {
    proxyUrl: 'https://proxy.teste',
    proxyServiceId: 'sistema2-backend',
    proxyServiceToken: 'tok-123',
  };

  it('cria o cliente quando as três variáveis existem', async () => {
    const fetchSimulado = fetchQueDevolve(resposta(200, SUCESSO));
    const cliente = ClienteProxy.aPartirDaConfig(COMPLETA, logger, {
      fetch: fetchSimulado,
      aquecimento: false,
    });

    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(fetchSimulado.mock.calls[0]?.[0]).toBe('https://proxy.teste/executar');
  });

  it('liga o aquecimento do proxy por padrão', async () => {
    const fetchSimulado = fetchQueDevolve(resposta(200, { ok: true }), resposta(200, SUCESSO));
    const cliente = ClienteProxy.aPartirDaConfig(COMPLETA, logger, { fetch: fetchSimulado });

    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(fetchSimulado.mock.calls.map(([url]) => url)).toEqual([
      'https://proxy.teste/saude',
      'https://proxy.teste/executar',
    ]);
  });

  it.each([
    [{}, ['PROXY_URL', 'PROXY_SERVICE_ID', 'PROXY_SERVICE_TOKEN']],
    [{ ...COMPLETA, proxyServiceToken: undefined }, ['PROXY_SERVICE_TOKEN']],
  ])('recusa configuração incompleta, citando o que falta', (config, faltando) => {
    const criar = () => ClienteProxy.aPartirDaConfig(config, logger);

    expect(criar).toThrow(ProxyNaoConfiguradoError);
    expect(criar).toThrow(faltando.join(', '));
  });
});

describe('ClienteProxy — proxy em espera (aquecimento)', () => {
  const saude = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const urls = (fetchSimulado: FetchSimulado) =>
    fetchSimulado.mock.calls.map(([url]) => String(url));
  const chamadasDeSaude = (fetchSimulado: FetchSimulado) =>
    urls(fetchSimulado).filter((url) => url.endsWith('/saude'));

  it('acorda o proxy com GET /saude antes da primeira operação', async () => {
    const fetchSimulado = fetchQueDevolve(saude(), resposta(200, SUCESSO));
    const { cliente } = montar(fetchSimulado, { aquecimento: true });

    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(urls(fetchSimulado)).toEqual([
      'https://proxy.teste/saude',
      'https://proxy.teste/executar',
    ]);
    expect(fetchSimulado.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(fetchSimulado.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it('não acorda de novo enquanto o proxy respondeu há pouco', async () => {
    const fetchSimulado = fetchQueDevolve(saude(), resposta(200, SUCESSO), resposta(200, SUCESSO));
    const { cliente } = montar(fetchSimulado, { aquecimento: true });

    await cliente.executar('dados.inserir', {}, 'UC02');
    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(chamadasDeSaude(fetchSimulado)).toHaveLength(1);
  });

  it('chamadas simultâneas compartilham um só aquecimento', async () => {
    const fetchSimulado = fetchQueDevolve(saude(), resposta(200, SUCESSO), resposta(200, SUCESSO));
    const { cliente } = montar(fetchSimulado, { aquecimento: true });

    await Promise.all([
      cliente.executar('dados.inserir', {}, 'UC02'),
      cliente.executar('dados.inserir', {}, 'UC02'),
    ]);

    expect(chamadasDeSaude(fetchSimulado)).toHaveLength(1);
    expect(fetchSimulado).toHaveBeenCalledTimes(3);
  });

  it('acorda de novo depois de um longo tempo sem contato', async () => {
    let agora = AGORA.getTime();
    const fetchSimulado = fetchQueDevolve(
      saude(),
      resposta(200, SUCESSO),
      saude(),
      resposta(200, SUCESSO),
    );
    const { cliente } = montar(fetchSimulado, {
      aquecimento: true,
      ociosidadeMaximaMs: 60_000,
      agora: () => new Date(agora),
    });

    await cliente.executar('dados.inserir', {}, 'UC02');
    agora += 61_000;
    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(chamadasDeSaude(fetchSimulado)).toHaveLength(2);
  });

  it('se o proxy não acordar, falha como serviço indisponível sem enviar a operação', async () => {
    const fetchSimulado = fetchQueDevolve(new TypeError('fetch failed'));
    const { cliente, linhas } = montar(fetchSimulado, { aquecimento: true });

    const erro = await capturar(cliente.executar('dados.inserir', {}, 'UC02'));

    expect(erro).toBeInstanceOf(ErroDeServicoIndisponivel);
    expect(urls(fetchSimulado)).toEqual(['https://proxy.teste/saude']);
    expect(linhas.join()).toContain('o proxy não acordou dentro do prazo');
  });

  it('trata /saude fora do ar (5xx) como proxy que não acordou', async () => {
    const fetchSimulado = fetchQueDevolve(resposta(503, '<html>starting</html>'));
    const { cliente } = montar(fetchSimulado, { aquecimento: true });

    const erro = await capturar(cliente.executar('dados.consultar', { tabela: 'x' }, 'UC03'));

    expect(erro).toBeInstanceOf(ErroDeServicoIndisponivel);
    expect(fetchSimulado).toHaveBeenCalledTimes(1);
  });

  it('usa o prazo longo no aquecimento e o prazo curto na operação', async () => {
    const fetchSimulado = fetchQueDevolve(saude(), resposta(200, SUCESSO));
    const { cliente } = montar(fetchSimulado, {
      aquecimento: true,
      tempoLimiteMs: 10,
      tempoLimiteAquecimentoMs: 60_000,
    });
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([60_000, 10]);
    timeout.mockRestore();
  });

  it('depois de uma falha de comunicação, acorda o proxy antes da próxima operação', async () => {
    const fetchSimulado = fetchQueDevolve(
      saude(),
      new TypeError('fetch failed'),
      saude(),
      resposta(200, SUCESSO),
    );
    const { cliente } = montar(fetchSimulado, { aquecimento: true });

    await capturar(cliente.executar('dados.inserir', {}, 'UC02'));
    await cliente.executar('dados.inserir', {}, 'UC02');

    expect(urls(fetchSimulado)).toEqual([
      'https://proxy.teste/saude',
      'https://proxy.teste/executar',
      'https://proxy.teste/saude',
      'https://proxy.teste/executar',
    ]);
  });

  it('numa leitura repetida por falha de rede, acorda o proxy antes da nova tentativa', async () => {
    const fetchSimulado = fetchQueDevolve(
      saude(),
      new TypeError('fetch failed'),
      saude(),
      resposta(200, SUCESSO),
    );
    const { cliente, esperar } = montar(fetchSimulado, { aquecimento: true });

    await cliente.executar('dados.consultar', { tabela: 'cliente' }, 'UC03');

    expect(urls(fetchSimulado)).toEqual([
      'https://proxy.teste/saude',
      'https://proxy.teste/executar',
      'https://proxy.teste/saude',
      'https://proxy.teste/executar',
    ]);
    expect(esperar).toHaveBeenCalledTimes(1);
  });

  it('sem aquecimento (padrão do construtor), nunca chama /saude', async () => {
    const fetchSimulado = fetchQueDevolve(resposta(200, SUCESSO));

    await montar(fetchSimulado).cliente.executar('dados.inserir', {}, 'UC02');

    expect(urls(fetchSimulado)).toEqual(['https://proxy.teste/executar']);
  });
});
