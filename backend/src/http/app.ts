// Item 1 do backend/TAREFAS.md — aplicação Express do backend, sem abrir porta.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from '../config';
import type { Logger } from '../log';
import { logRequisicao } from './middlewares/logRequisicao';
import { CABECALHO_REQUEST_ID, requestId } from './middlewares/requestId';
import { rotaNaoEncontrada } from './middlewares/rotaNaoEncontrada';
import { tratamentoDeErros } from './middlewares/tratamentoDeErros';
import { criarRotasDeSaude } from './rotas/saude';

/** Tamanho máximo do corpo JSON de uma requisição. */
export const LIMITE_DO_CORPO_JSON = '100kb';

const METODOS_PERMITIDOS_NO_CORS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CABECALHOS_PERMITIDOS_NO_CORS = ['Authorization', 'Content-Type'];

/** O que a aplicação precisa receber pronto de quem a monta. */
export interface DependenciasDoApp {
  readonly config: Config;
  readonly logger: Logger;
}

/**
 * Monta a aplicação Express com os middlewares globais, as rotas e o tratamento de erros.
 *
 * Não chama `listen`: quem sobe o servidor é o `index.ts`, e os testes usam a aplicação direto.
 * As próximas entregas registram suas rotas depois das rotas de saúde e antes de
 * `rotaNaoEncontrada`.
 */
export function createApp({ config, logger }: DependenciasDoApp): Express {
  const app = express();

  app.use(requestId());
  app.use(logRequisicao(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: [...config.corsOrigens],
      methods: METODOS_PERMITIDOS_NO_CORS,
      allowedHeaders: CABECALHOS_PERMITIDOS_NO_CORS,
      exposedHeaders: [CABECALHO_REQUEST_ID],
    }),
  );
  app.use(express.json({ limit: LIMITE_DO_CORPO_JSON }));

  app.use(criarRotasDeSaude());

  app.use(rotaNaoEncontrada());
  app.use(tratamentoDeErros(logger));

  return app;
}
