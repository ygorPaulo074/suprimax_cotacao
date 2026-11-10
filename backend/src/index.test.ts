import { EventEmitter } from 'node:events';
import type { Config } from './config';
import { principal, ServidorHttp, ServidorHttpError, type ProcessoEncerravel } from './index';
import { criarLogger } from './log';

// Porta 0: o sistema operacional escolhe uma porta livre, então o teste não depende de porta fixa.
const CONFIG: Config = { ambiente: 'dev', porta: 0, nivelLog: 'silent', corsOrigens: [] };
const LOGGER = criarLogger({ nivel: 'silent' });

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
    const servidor = new ServidorHttp(CONFIG, LOGGER);
    await servidor.iniciar();
    const url = `http://127.0.0.1:${servidor.porta}/saude`;

    const resposta = await fetch(url);
    expect(await resposta.json()).toEqual({ status: 'ok' });

    await servidor.encerrar();
    await servidor.encerrar();
    await expect(fetch(url)).rejects.toThrow();
  });

  it('recusa uso fora de ordem', async () => {
    const servidor = new ServidorHttp(CONFIG, LOGGER);

    expect(() => servidor.porta).toThrow(ServidorHttpError);
    await servidor.iniciar();
    await expect(servidor.iniciar()).rejects.toThrow(ServidorHttpError);
    await servidor.encerrar();
  });

  it('falha ao iniciar em porta já ocupada', async () => {
    const primeiro = new ServidorHttp(CONFIG, LOGGER);
    await primeiro.iniciar();
    const segundo = new ServidorHttp({ ...CONFIG, porta: primeiro.porta }, LOGGER);

    await expect(segundo.iniciar()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await primeiro.encerrar();
  });

  it.each(['SIGTERM', 'SIGINT'])('encerra e sai com código 0 ao receber %s', async (sinal) => {
    const { processo, saida, enviar } = criarProcessoFalso();
    const servidor = new ServidorHttp(CONFIG, LOGGER);
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
