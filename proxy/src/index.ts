import pino from 'pino';
import { Auditoria, RepositorioAuditoriaPg } from './auditoria/auditoria';
import { CacheReplay } from './auth/autenticacao';
import { RepositorioIntegrantesPg } from './auth/integrantes';
import { criarExecutorPg } from './banco/pg';
import { carregarConfig } from './config';
import { esquemaDoDicionario } from './esquema/esquema';
import { FilaEscrita, RepositorioFilaPg } from './fila/fila';
import { retomarFila } from './fila/retomada';
import { criarApp } from './http/app';
import type { DepsServidor } from './http/processar';

const config = carregarConfig();
const logger = pino({
  level: config.env === 'dev' ? 'debug' : 'info',
  redact: ['req.headers.authorization'],
});

if (!config.databaseUrl) {
  logger.fatal('DATABASE_URL é obrigatório para executar SQL no banco compartilhado');
  process.exit(1);
}

const banco = criarExecutorPg(config.databaseUrl);
const repositorioFila = new RepositorioFilaPg(banco);
const deps: DepsServidor = {
  config,
  esquema: esquemaDoDicionario,
  banco,
  integrantes: new RepositorioIntegrantesPg(banco),
  fila: new FilaEscrita(repositorioFila),
  auditoria: new Auditoria(logger, new RepositorioAuditoriaPg(banco)),
  replay: new CacheReplay(config.toleranciaTimestampSegundos * 2 * 1000),
  logger,
  agora: () => new Date(),
};
const app = criarApp(deps);

// A fila deixada por um reinício é retomada antes de aceitar requisições (docs/12, seção 12.5).
// Se o banco não responder a tempo, o proxy sobe assim mesmo (o /saude precisa responder) e a
// retomada termina em segundo plano; a trava de cada item continua impedindo execução dupla.
const ESPERA_MAXIMA_RETOMADA_MS = 30_000;
let servidor: ReturnType<typeof app.listen> | undefined;
const retomada = retomarFila(deps, repositorioFila);
void Promise.race([
  retomada,
  new Promise((resolver) => setTimeout(resolver, ESPERA_MAXIMA_RETOMADA_MS).unref()),
]).finally(() => {
  servidor = app.listen(config.porta, () => {
    logger.info({ porta: config.porta, ambiente: config.env }, 'proxy no ar');
  });
});

function encerrar(sinal: string): void {
  logger.info({ sinal }, 'encerrando');
  const fechar = () => void banco.fechar().finally(() => process.exit(0));
  if (servidor) servidor.close(fechar);
  else fechar();
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
