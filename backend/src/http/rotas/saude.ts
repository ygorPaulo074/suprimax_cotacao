// Item 1 do backend/TAREFAS.md — verificação de saúde do serviço (usada pelo Render).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';

export const ROTA_SAUDE = '/saude';

/** Corpo de `GET /saude`. */
export interface RespostaDeSaude {
  readonly status: 'ok';
}

const RESPOSTA_DE_SAUDE: RespostaDeSaude = { status: 'ok' };

/**
 * Rotas de saúde. `GET /saude` responde `200 { "status": "ok" }` enquanto o processo estiver de
 * pé. Não consulta proxy nem banco e não expõe ambiente nem versão.
 */
export function criarRotasDeSaude(): Router {
  const rotas = Router();
  rotas.get(ROTA_SAUDE, (_req, res) => {
    res.status(STATUS_HTTP.OK).json(RESPOSTA_DE_SAUDE);
  });
  return rotas;
}
