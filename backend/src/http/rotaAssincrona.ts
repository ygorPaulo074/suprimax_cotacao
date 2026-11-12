// UC13 — o Express 4 não captura a rejeição de um manipulador assíncrono; este adaptador a
// encaminha ao tratamento de erros.
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Manipulador de rota que devolve uma promessa. */
export type ManipuladorAssincrono = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/** Adapta um manipulador assíncrono: se a promessa for rejeitada, o erro segue para `next`. */
export function rotaAssincrona(manipulador: ManipuladorAssincrono): RequestHandler {
  return (req, res, next) => {
    manipulador(req, res, next).catch(next);
  };
}
