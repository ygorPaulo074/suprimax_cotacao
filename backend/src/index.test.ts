import { EventEmitter } from 'node:events';
import { ErroDeServicoIndisponivel } from './erros';
import {
  criarClienteDeProxy,
  principal,
  ServidorHttp,
  ServidorHttpError,
  type ProcessoEncerravel,
} from './index';
import { criarLogger } from './log';
import { CONFIG_DE_TESTE, montarAppDeTeste } from './testing/appDeTeste';

// Porta 0: o sistema operacional escolhe uma porta livre, então o teste não depende de porta fixa.
const { dependencias: DEPENDENCIAS } = montarAppDeTeste({ config: { nivelLog: 'silent' } });

/** Substituto de `process`: recebe sinais e avisa quando `exit` é chamado. */
function criarProcessoFalso() {
  const emissor = new EventEmitter();
  let avisar: (codigo: number) => void;
  const saida = new Promise<number>((resolve) => (avisar = resolve));
  const processo = {
    once: (sinal: string, ouvinte: () => void) => emissor.once(sinal, ouvinte),
    exit: (codigo: number) => avisar(codigo),
  } as unknown as ProcessoEncerravel;
  return { processo, saida, enviar: (sinal: string) => emissor.emit(sinal) };
}

describe('ServidorHttp', () => {
  it('sobe em uma porta livre, atende /saude e encerra', async () => {
    const servidor = new ServidorHttp(DEPENDENCIAS);
    await servidor.iniciar();
    const url = `http://127.0.0.1:${servidor.porta}/saude`;

    const resposta = await fetch(url);
    expect(await resposta.json()).toEqual({ status: 'ok' });

    await servidor.encerrar();
    await servidor.encerrar();
    await expect(fetch(url)).rejects.toThrow();
  });

  it('recusa uso fora de ordem', async () => {
    const servidor = new ServidorHttp(DEPENDENCIAS);

    expect(() => servidor.porta).toThrow(ServidorHttpError);
    await servidor.iniciar();
    await expect(servidor.iniciar()).rejects.toThrow(ServidorHttpError);
    await servidor.encerrar();
  });

  it('falha ao iniciar em porta já ocupada', async () => {
    const primeiro = new ServidorHttp(DEPENDENCIAS);
    await primeiro.iniciar();
    const segundo = new ServidorHttp({
      ...DEPENDENCIAS,
      config: { ...DEPENDENCIAS.config, porta: primeiro.porta },
    });

    await expect(segundo.iniciar()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await primeiro.encerrar();
  });

  it.each(['SIGTERM', 'SIGINT'])('encerra e sai com código 0 ao receber %s', async (sinal) => {
    const { processo, saida, enviar } = criarProcessoFalso();
    const servidor = new ServidorHttp(DEPENDENCIAS);
    await servidor.iniciar();
    servidor.registrarEncerramento(processo);

    enviar(sinal);

    expect(await saida).toBe(0);
    expect(servidor.encerrar()).toBe(servidor.encerrar());
  });
});

describe('principal', () => {
  it('registra as variáveis inválidas, sem os valores, e sai com código 1', async () => {
    const { processo, saida } = criarProcessoFalso();
    const linhas: string[] = [];

    await principal({ PORT: 'valor-secreto' }, processo, { write: (l) => void linhas.push(l) });

    expect(await saida).toBe(1);
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0] ?? '')).toMatchObject({ level: 'fatal', variaveis: ['PORT'] });
    expect(linhas[0]).not.toContain('valor-secreto');
  });
});

describe('criarClienteDeProxy', () => {
  const logger = criarLogger({ nivel: 'silent' });

  it('sem as variáveis do proxy, devolve um cliente que responde 503', async () => {
    const cliente = criarClienteDeProxy(CONFIG_DE_TESTE, logger);

    await expect(cliente.executar('dados.consultar', {}, 'UC')).rejects.toBeInstanceOf(
      ErroDeServicoIndisponivel,
    );
  });

  it('com as três variáveis, devolve o cliente real', () => {
    const config = {
      ...CONFIG_DE_TESTE,
      proxyUrl: 'https://proxy.teste',
      proxyServiceId: 'sistema2-backend',
      proxyServiceToken: 'tok-123',
    };

    expect(criarClienteDeProxy(config, logger).constructor.name).toBe('ClienteProxy');
  });
});
