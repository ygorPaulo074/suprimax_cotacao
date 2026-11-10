// Item 1 do backend/TAREFAS.md — ponto único que transforma erro em resposta HTTP.
import type { ErrorRequestHandler } from 'express';
import { AppError, ErroDeValidacao, ErroInterno, STATUS_HTTP } from '../../erros';
import type { Logger } from '../../log';
import { registrarCodigoDeErro } from './logRequisicao';
import { obterRequestId } from './requestId';

const MENSAGEM_REQUISICAO_MALFORMADA = 'A requisição está malformada ou não é um JSON válido.';
const MENSAGEM_DO_LOG_ERRO_INTERNO = 'erro interno';

interface ErroHttpDeBiblioteca {
  readonly status: number;
  readonly expose: true;
}

/**
 * Erros que o Express e o body-parser marcam como culpa do cliente (JSON inválido, corpo grande
 * demais, URL malformada): têm `status` 4xx e `expose: true`.
 */
function ehErroDoCliente(erro: unknown): erro is ErroHttpDeBiblioteca {
  if (typeof erro !== 'object' || erro === null) {
    return false;
  }
  const { status, expose } = erro as { status?: unknown; expose?: unknown };
  return (
    expose === true &&
    typeof status === 'number' &&
    status >= STATUS_HTTP.REQUISICAO_INVALIDA &&
    status < STATUS_HTTP.ERRO_INTERNO
  );
}

/**
 * Converte qualquer erro em AppError. A mensagem original de bibliotecas nunca é reaproveitada:
 * ou o erro entra em um código do catálogo, ou vira erro interno.
 */
export function converterEmAppError(erro: unknown): AppError {
  if (erro instanceof AppError) {
    return erro;
  }
  if (ehErroDoCliente(erro)) {
    return erro.status === STATUS_HTTP.CORPO_GRANDE_DEMAIS
      ? new AppError('PAYLOAD_TOO_LARGE', { causa: erro })
      : new ErroDeValidacao({ mensagem: MENSAGEM_REQUISICAO_MALFORMADA, causa: erro });
  }
  return new ErroInterno(erro);
}

/**
 * Middleware final: responde todo erro no formato `{ codigo, mensagem, detalhes? }`.
 *
 * Em erro interno, a causa e o stack vão só para o log, com o requestId; a resposta leva apenas
 * a mensagem genérica do catálogo.
 */
export function tratamentoDeErros(logger: Logger): ErrorRequestHandler {
  // O Express só reconhece o middleware de erro pelos quatro parâmetros.
  return (erro: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(erro);
      return;
    }
    const appError = converterEmAppError(erro);
    registrarCodigoDeErro(res, appError.codigo);
    if (appError.status >= STATUS_HTTP.ERRO_INTERNO) {
      logger.error(
        {
          requestId: obterRequestId(res),
          codigoOriginal: appError.codigoOriginal,
          err: appError.cause ?? appError,
        },
        MENSAGEM_DO_LOG_ERRO_INTERNO,
      );
    }
    res.status(appError.status).json(appError.paraCorpo());
  };
}
