// Item 1 do backend/TAREFAS.md — identificador único por requisição, para rastrear nos logs.
import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

/** Cabeçalho de resposta com o identificador da requisição. */
export const CABECALHO_REQUEST_ID = 'X-Request-Id';

const CHAVE_LOCAL_REQUEST_ID = 'requestId';

/**
 * Gera um identificador para cada requisição, devolve-o no cabeçalho `X-Request-Id` e o guarda
 * para os demais middlewares.
 *
 * O identificador é sempre gerado aqui: um valor enviado pelo cliente não é reaproveitado, para
 * que ele não consiga escrever texto arbitrário nos logs.
 */
export function requestId(): RequestHandler {
  return (_req, res, next) => {
    const id = randomUUID();
    res.locals[CHAVE_LOCAL_REQUEST_ID] = id;
    res.setHeader(CABECALHO_REQUEST_ID, id);
    next();
  };
}

/** Lê o identificador da requisição atual; `undefined` se o middleware não rodou. */
export function obterRequestId(res: Response): string | undefined {
  const id: unknown = res.locals[CHAVE_LOCAL_REQUEST_ID];
  return typeof id === 'string' ? id : undefined;
}
