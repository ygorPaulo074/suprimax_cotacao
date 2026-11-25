// Item 1 do backend/TAREFAS.md — verificação de saúde do serviço (usada pelo Render).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ErroDeLimiteExcedido, STATUS_HTTP } from '../../erros';
import type { VerificadorDeSaude } from '../saudeCompleta';

export const ROTA_SAUDE = '/saude';
export const ROTA_SAUDE_COMPLETA = '/saude/completa';

/** Verificações completas aceitas por IP e por minuto; a verificação em si é compartilhada por poucos segundos. */
export const MAXIMO_DE_VERIFICACOES_POR_MINUTO = 60;

/** Corpo de `GET /saude`. */
export interface RespostaDeSaude {
  readonly status: 'ok';
}

const RESPOSTA_DE_SAUDE: RespostaDeSaude = { status: 'ok' };

/**
 * Rotas de saúde.
 *
 * `GET /saude` responde `200 { "status": "ok" }` enquanto o processo estiver de pé. Não consulta
 * proxy nem banco e não expõe ambiente nem versão (é a que o Render usa).
 *
 * `GET /saude/completa` (só com `verificador`) confere proxy, leitura e gravação no banco e a criação
 * de sessão. Responde sempre `200` com `ok` verdadeiro ou falso e o resultado de cada etapa, para a
 * página de aguardo do frontend decidir se libera o sistema. Pública, com limite por IP, e a resposta
 * só leva códigos curtos de erro.
 */
export function criarRotasDeSaude(verificador?: VerificadorDeSaude): Router {
  const rotas = Router();
  rotas.get(ROTA_SAUDE, (_req, res) => {
    res.status(STATUS_HTTP.OK).json(RESPOSTA_DE_SAUDE);
  });
  if (verificador) {
    const limite = rateLimit({
      windowMs: 60_000,
      limit: MAXIMO_DE_VERIFICACOES_POR_MINUTO,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new ErroDeLimiteExcedido()),
    });
    rotas.get(ROTA_SAUDE_COMPLETA, limite, (_req, res, next) => {
      verificador()
        .then((resposta) => res.status(STATUS_HTTP.OK).json(resposta))
        .catch(next);
    });
  }
  return rotas;
}
