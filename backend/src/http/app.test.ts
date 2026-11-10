import request from 'supertest';
import type { Config } from '../config';
import { criarLogger } from '../log';
import { createApp } from './app';

const ORIGEM_PERMITIDA = 'https://cotacao.suprimax.com.br';
const CONFIG: Config = {
  ambiente: 'dev',
  porta: 0,
  nivelLog: 'info',
  corsOrigens: [ORIGEM_PERMITIDA],
};
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function montar() {
  const linhas: Record<string, unknown>[] = [];
  const destino = { write: (linha: string) => void linhas.push(JSON.parse(linha)) };
  const app = createApp({ config: CONFIG, logger: criarLogger({ nivel: 'info', destino }) });
  return { app, linhas };
}

describe('GET /saude', () => {
  it('responde 200 { status: "ok" } e nada além disso', async () => {
    const resposta = await request(montar().app).get('/saude');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ status: 'ok' });
    expect(resposta.headers['x-powered-by']).toBeUndefined();
  });
});

describe('erros padronizados', () => {
  it('rota inexistente responde 404 NOT_FOUND', async () => {
    const resposta = await request(montar().app).get('/nao-existe');

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({ codigo: 'NOT_FOUND', mensagem: 'Rota não encontrada.' });
  });

  it('JSON inválido responde 400 VALIDATION_ERROR, sem a mensagem do parser', async () => {
    const resposta = await request(montar().app)
      .post('/saude')
      .set('Content-Type', 'application/json')
      .send('{ "usuario": ');

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({
      codigo: 'VALIDATION_ERROR',
      mensagem: 'A requisição está malformada ou não é um JSON válido.',
    });
  });

  it('corpo acima do limite responde 413 PAYLOAD_TOO_LARGE', async () => {
    const resposta = await request(montar().app)
      .post('/saude')
      .send({ texto: 'a'.repeat(200 * 1024) });

    expect(resposta.status).toBe(413);
    expect(resposta.body.codigo).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('X-Request-Id e log da requisição', () => {
  it('devolve um identificador novo por requisição, o mesmo da linha de log', async () => {
    const { app, linhas } = montar();

    const primeira = await request(app).get('/saude?token=nao-deve-aparecer');
    const segunda = await request(app).get('/nao-existe');

    const ids = [primeira.headers['x-request-id'], segunda.headers['x-request-id']];
    expect(ids[0]).toMatch(PADRAO_UUID);
    expect(ids[1]).toMatch(PADRAO_UUID);
    expect(ids[0]).not.toBe(ids[1]);
    expect(linhas).toEqual([
      expect.objectContaining({
        level: 'info',
        requestId: ids[0],
        metodo: 'GET',
        rota: '/saude',
        status: 200,
        duracaoMs: expect.any(Number),
      }),
      expect.objectContaining({
        level: 'warn',
        requestId: ids[1],
        rota: '/nao-existe',
        status: 404,
        codigoDeErro: 'NOT_FOUND',
      }),
    ]);
  });

  it('ignora o X-Request-Id enviado pelo cliente', async () => {
    const resposta = await request(montar().app).get('/saude').set('X-Request-Id', 'forjado');

    expect(resposta.headers['x-request-id']).toMatch(PADRAO_UUID);
  });
});

describe('CORS', () => {
  it.each([
    [ORIGEM_PERMITIDA, ORIGEM_PERMITIDA],
    ['https://outro-site.com', undefined],
  ])('origem %s recebe Access-Control-Allow-Origin = %s', async (origem, esperado) => {
    const resposta = await request(montar().app).get('/saude').set('Origin', origem);

    expect(resposta.headers['access-control-allow-origin']).toBe(esperado);
  });
});
