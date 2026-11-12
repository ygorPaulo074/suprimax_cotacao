// As respostas da API trazem dados de clientes, usuários e preços: nenhuma delas pode ficar
// guardada no navegador nem em caches intermediários (LGPD; docs/13, seção 13.5).
import type { RequestHandler } from 'express';

export const CABECALHO_DE_CACHE = 'Cache-Control';
export const SEM_CACHE = 'no-store';

/** Marca toda resposta com `Cache-Control: no-store`. */
export function semCache(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader(CABECALHO_DE_CACHE, SEM_CACHE);
    next();
  };
}
