// Item 1 do backend/TAREFAS.md — resposta padronizada para rota inexistente.
import type { RequestHandler } from 'express';
import { ErroNaoEncontrado } from '../../erros';

const MENSAGEM_ROTA_NAO_ENCONTRADA = 'Rota não encontrada.';

/** Encaminha `404 NOT_FOUND` ao tratamento de erros quando nenhuma rota atendeu a requisição. */
export function rotaNaoEncontrada(): RequestHandler {
  return (_req, _res, next) => {
    next(new ErroNaoEncontrado({ mensagem: MENSAGEM_ROTA_NAO_ENCONTRADA }));
  };
}
