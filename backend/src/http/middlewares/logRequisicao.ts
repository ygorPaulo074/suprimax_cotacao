// Item 1 do backend/TAREFAS.md — uma linha de log por requisição.
import type { RequestHandler, Response } from 'express';
import { STATUS_HTTP, type CodigoDeErro } from '../../erros';
import type { Logger } from '../../log';
import { obterRequestId } from './requestId';

const CHAVE_LOCAL_CODIGO_DE_ERRO = 'codigoDeErro';
const SEPARADOR_DA_QUERY = '?';
const NANOSSEGUNDOS_POR_MILISSEGUNDO = 1_000_000n;
const MENSAGEM_DO_LOG = 'requisicao';

/** Anota o código do erro respondido, para ele aparecer na linha de log da requisição. */
export function registrarCodigoDeErro(res: Response, codigo: CodigoDeErro): void {
  res.locals[CHAVE_LOCAL_CODIGO_DE_ERRO] = codigo;
}

function nivelDoStatus(status: number): 'info' | 'warn' | 'error' {
  if (status >= STATUS_HTTP.ERRO_INTERNO) {
    return 'error';
  }
  return status >= STATUS_HTTP.REQUISICAO_INVALIDA ? 'warn' : 'info';
}

/**
 * Registra uma linha por requisição concluída: método, rota, status, duração e requestId.
 *
 * Corpo, cabeçalhos e query string ficam fora do log, porque podem carregar senha ou token.
 */
export function logRequisicao(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      const duracaoMs = Number((process.hrtime.bigint() - inicio) / NANOSSEGUNDOS_POR_MILISSEGUNDO);
      const codigoDeErro: unknown = res.locals[CHAVE_LOCAL_CODIGO_DE_ERRO];
      logger[nivelDoStatus(res.statusCode)](
        {
          requestId: obterRequestId(res),
          metodo: req.method,
          rota: req.originalUrl.split(SEPARADOR_DA_QUERY)[0],
          status: res.statusCode,
          duracaoMs,
          ...(typeof codigoDeErro === 'string' && { codigoDeErro }),
        },
        MENSAGEM_DO_LOG,
      );
    });
    next();
  };
}
