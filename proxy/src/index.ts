import pino from 'pino';
import { Auditoria, RepositorioAuditoriaPg } from './auditoria/auditoria';
import { CacheReplay } from './auth/autenticacao';
import { RepositorioIntegrantesPg } from './auth/integrantes';
import { criarExecutorPg } from './banco/pg';
import { carregarConfig } from './config';
import { esquemaDoDicionario } from './esquema/esquema';
import { FilaEscrita, RepositorioFilaPg } from './fila/fila';
import { criarApp } from './http/app';

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
const app = criarApp({
  config,
  esquema: esquemaDoDicionario,
  banco,
  integrantes: new RepositorioIntegrantesPg(banco),
  fila: new FilaEscrita(new RepositorioFilaPg(banco)),
  auditoria: new Auditoria(logger, new RepositorioAuditoriaPg(banco)),
  replay: new CacheReplay(config.toleranciaTimestampSegundos * 2 * 1000),
  logger,
  agora: () => new Date(),
});

const servidor = app.listen(config.porta, () => {
  logger.info({ porta: config.porta, ambiente: config.env }, 'proxy no ar');
});

function encerrar(sinal: string): void {
  logger.info({ sinal }, 'encerrando');
  servidor.close(() => {
    void banco.fechar().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
