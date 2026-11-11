// Montagem da aplicação para os testes de rota: proxy em dublê, sessões em memória, hash barato
// e log capturado em memória.
import type { Express } from 'express';
import type { Config } from '../config';
import { createApp, type DependenciasDoApp } from '../http/app';
import { criarLogger } from '../log';
import { ServicoDeSenha } from '../modulos/auth/senha';
import { RepositorioDeSessoesEmMemoria } from '../modulos/auth/sessoes';
import { ProxyClienteFalso } from './proxyClienteFalso';

/** Custo mínimo do bcrypt: os testes não precisam de um hash resistente, e sim rápido. */
export const CUSTO_DO_BCRYPT_NOS_TESTES = 4;

export const ORIGEM_DE_TESTE = 'https://cotacao.suprimax.com.br';

/** Configuração válida para os testes. Porta 0: o sistema escolhe uma porta livre. */
export const CONFIG_DE_TESTE: Config = {
  ambiente: 'dev',
  porta: 0,
  nivelLog: 'info',
  corsOrigens: [ORIGEM_DE_TESTE],
  sessaoInatividadeMs: 30 * 60 * 1000,
  trustProxy: 0,
};

export interface OpcoesDoAppDeTeste {
  readonly config?: Partial<Config>;
  readonly auth?: DependenciasDoApp['auth'];
  /** Relógio das sessões e do login. */
  readonly agora?: () => Date;
}

export interface AppDeTeste {
  readonly app: Express;
  readonly proxy: ProxyClienteFalso;
  readonly sessoes: RepositorioDeSessoesEmMemoria;
  readonly senhas: ServicoDeSenha;
  /** Linhas de log emitidas, já convertidas de JSON. */
  readonly linhas: Record<string, unknown>[];
  /** As mesmas dependências entregues a `createApp`. */
  readonly dependencias: DependenciasDoApp;
}

/** Monta a aplicação com dublês e devolve também os dublês, para o teste programar e conferir. */
export function montarAppDeTeste(opcoes: OpcoesDoAppDeTeste = {}): AppDeTeste {
  const linhas: Record<string, unknown>[] = [];
  const destino = { write: (linha: string) => void linhas.push(JSON.parse(linha)) };
  const config: Config = { ...CONFIG_DE_TESTE, ...opcoes.config };
  const proxy = new ProxyClienteFalso();
  const senhas = new ServicoDeSenha(CUSTO_DO_BCRYPT_NOS_TESTES);
  const sessoes = new RepositorioDeSessoesEmMemoria({
    inatividadeMs: config.sessaoInatividadeMs,
    agora: opcoes.agora,
  });
  const dependencias: DependenciasDoApp = {
    config,
    logger: criarLogger({ nivel: config.nivelLog, destino }),
    proxy,
    sessoes,
    auth: { senhas, agora: opcoes.agora, ...opcoes.auth },
  };
  return { app: createApp(dependencias), proxy, sessoes, senhas, linhas, dependencias };
}
