// Item 1 do backend/TAREFAS.md — aplicação Express do backend, sem abrir porta.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from '../config';
import type { ClienteDeProxy } from '../dados';
import type { Logger } from '../log';
import { criarModuloDeAuth, type DependenciasDoModuloDeAuth } from '../modulos/auth';
import type { RepositorioDeSessoes } from '../modulos/auth/sessoes';
import { criarModuloDeClientes } from '../modulos/clientes';
import { criarModuloDeFornecedores } from '../modulos/fornecedores';
import { criarModuloDeProdutos } from '../modulos/produtos';
import { criarModuloDeUsuarios, type NotificadorDeEmail } from '../modulos/usuarios';
import { logRequisicao } from './middlewares/logRequisicao';
import { CABECALHO_REQUEST_ID, requestId } from './middlewares/requestId';
import { rotaNaoEncontrada } from './middlewares/rotaNaoEncontrada';
import { semCache } from './middlewares/semCache';
import { tratamentoDeErros } from './middlewares/tratamentoDeErros';
import { criarRotasDeSaude } from './rotas/saude';

/** Tamanho máximo do corpo JSON de uma requisição. */
export const LIMITE_DO_CORPO_JSON = '100kb';

const CONFIGURACAO_TRUST_PROXY = 'trust proxy';
const METODOS_PERMITIDOS_NO_CORS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const CABECALHOS_PERMITIDOS_NO_CORS = ['Authorization', 'Content-Type'];

/** O que a aplicação precisa receber pronto de quem a monta. */
export interface DependenciasDoApp {
  readonly config: Config;
  readonly logger: Logger;
  /** Acesso a dados; os testes passam o dublê. */
  readonly proxy: ClienteDeProxy;
  /** Sessões abertas, compartilhadas por todos os módulos. */
  readonly sessoes: RepositorioDeSessoes;
  /**
   * Ajustes para os testes: custo do hash, limite de login e relógio. O hash e o relógio valem
   * também para os módulos de cadastro.
   */
  readonly auth?: Pick<DependenciasDoModuloDeAuth, 'senhas' | 'limiteDeLogin' | 'agora'>;
  /** Envio de e-mails; por padrão, o notificador que só registra em log. */
  readonly notificador?: NotificadorDeEmail;
}

/**
 * Monta a aplicação Express com os middlewares globais, as rotas e o tratamento de erros.
 *
 * Não chama `listen`: quem sobe o servidor é o `index.ts`, e os testes usam a aplicação direto.
 * As próximas entregas registram suas rotas depois das rotas de saúde e antes de
 * `rotaNaoEncontrada`.
 */
export function createApp({
  config,
  logger,
  proxy,
  sessoes,
  auth,
  notificador,
}: DependenciasDoApp): Express {
  const app = express();
  // Define de onde vem o IP do cliente (req.ip), usado no limite de tentativas de login.
  app.set(CONFIGURACAO_TRUST_PROXY, config.trustProxy);

  app.use(requestId());
  app.use(logRequisicao(logger));
  app.use(helmet());
  app.use(semCache());
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
  const comuns = { proxy, sessoes, logger };
  const { senhas, agora } = auth ?? {};
  app.use(criarModuloDeAuth({ ...comuns, ...auth }).rotas);
  app.use(criarModuloDeClientes({ ...comuns, agora }).rotas);
  app.use(criarModuloDeProdutos(comuns).rotas);
  app.use(criarModuloDeFornecedores(comuns).rotas);
  app.use(criarModuloDeUsuarios({ ...comuns, senhas, agora, notificador }).rotas);

  app.use(rotaNaoEncontrada());
  app.use(tratamentoDeErros(logger));

  return app;
}
