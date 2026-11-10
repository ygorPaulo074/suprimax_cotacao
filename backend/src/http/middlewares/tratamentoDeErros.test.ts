import express from 'express';
import request from 'supertest';
import { AppError, ErroDeValidacao, ErroInterno } from '../../erros';
import { criarLogger } from '../../log';
import { requestId } from './requestId';
import { converterEmAppError, tratamentoDeErros } from './tratamentoDeErros';

const MENSAGEM_DO_DRIVER = 'relation "operador" does not exist';

function montarAppQueFalha(erro: unknown) {
  const linhas: Record<string, unknown>[] = [];
  const destino = { write: (linha: string) => void linhas.push(JSON.parse(linha)) };
  const app = express();
  app.use(requestId());
  app.get('/falha', () => {
    throw erro;
  });
  app.use(tratamentoDeErros(criarLogger({ nivel: 'info', destino })));
  return { app, linhas };
}

describe('tratamentoDeErros', () => {
  it('erro inesperado responde 500 genérico; o detalhe fica só no log, com o requestId', async () => {
    const { app, linhas } = montarAppQueFalha(new Error(MENSAGEM_DO_DRIVER));

    const resposta = await request(app).get('/falha');

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({
      codigo: 'INTERNAL_ERROR',
      mensagem: 'Ocorreu um erro interno. Tente novamente em instantes.',
    });
    expect(resposta.text).not.toContain('operador');
    expect(linhas).toEqual([
      expect.objectContaining({
        level: 'error',
        requestId: resposta.headers['x-request-id'],
        err: expect.objectContaining({ message: MENSAGEM_DO_DRIVER }),
      }),
    ]);
  });

  it('AppError responde com o próprio status e corpo, sem log de erro interno', async () => {
    const erro = new ErroDeValidacao({ detalhes: { campo: 'cnpj' } });
    const { app, linhas } = montarAppQueFalha(erro);

    const resposta = await request(app).get('/falha');

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual(erro.paraCorpo());
    expect(linhas).toEqual([]);
  });

  it('AppError com código fora do catálogo registra o código original no log', async () => {
    const { app, linhas } = montarAppQueFalha(new AppError('CODIGO_SEM_ENTRADA'));

    const resposta = await request(app).get('/falha');

    expect(resposta.body.codigo).toBe('INTERNAL_ERROR');
    expect(linhas[0]).toMatchObject({ codigoOriginal: 'CODIGO_SEM_ENTRADA' });
  });
});

describe('converterEmAppError', () => {
  it.each([
    ['erro 400 exposto pela biblioteca', { status: 400, expose: true }, 'VALIDATION_ERROR'],
    ['erro 415 exposto pela biblioteca', { status: 415, expose: true }, 'VALIDATION_ERROR'],
    ['erro 413 exposto pela biblioteca', { status: 413, expose: true }, 'PAYLOAD_TOO_LARGE'],
    ['erro 4xx não exposto', { status: 404, expose: false }, 'INTERNAL_ERROR'],
    ['erro 5xx de biblioteca', { status: 503, expose: true }, 'INTERNAL_ERROR'],
    ['Error comum', new Error('falha'), 'INTERNAL_ERROR'],
    ['valor que não é erro', 'texto', 'INTERNAL_ERROR'],
  ])('%s vira %s', (_descricao, erro, codigo) => {
    expect(converterEmAppError(erro).codigo).toBe(codigo);
  });

  it('mantém o AppError recebido', () => {
    const erro = new ErroInterno();

    expect(converterEmAppError(erro)).toBe(erro);
  });
});
