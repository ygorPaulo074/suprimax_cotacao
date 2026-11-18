// Montagem da aplicação para os testes de rota: proxy em dublê, sessões em memória, hash barato
// e log capturado em memória.
import type { Express } from 'express';
import type { Config } from '../config';
import { ArmazenamentoEmMemoria } from '../dados/armazenamento';
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
  sessoesNoBanco: false,
  trustProxy: 0,
  jobsAgendadosHabilitados: false,
  jobsAgendadosIntervaloMs: 60 * 60 * 1000,
  empresaEmissora: {
    razaoSocial: 'SupriMax Distribuidora de Papéis Ltda.',
    endereco: 'Rua de Teste, 123 — Centro — Cidade/UF — 00000-000',
    telefone: '(00) 0000-0000',
    cnpj: '00.000.000/0001-00',
    inscricaoEstadual: '000.000.000.000',
    pix: 'financeiro@suprimax-teste.com.br',
    dadosBancarios: 'Banco de Teste — Agência 0001 — Conta 123456-7',
  },
};

export interface OpcoesDoAppDeTeste {
  readonly config?: Partial<Config>;
  readonly auth?: DependenciasDoApp['auth'];
  /** Relógio das sessões, do login e dos cadastros. */
  readonly agora?: () => Date;
  /** Dublê do envio de e-mails de definição de senha a usuário novo. */
  readonly notificador?: DependenciasDoApp['notificador'];
  /** Dublê do envio de e-mails de recuperação de senha. */
  readonly notificadorDeRecuperacao?: DependenciasDoApp['notificadorDeRecuperacao'];
  /** Dublê do envio de e-mail com anexo (UC08). */
  readonly enviadorDeEmail?: DependenciasDoApp['enviadorDeEmail'];
}

export interface AppDeTeste {
  readonly app: Express;
  readonly proxy: ProxyClienteFalso;
  readonly sessoes: RepositorioDeSessoesEmMemoria;
  /** Armazenamento de anexos em memória. */
  readonly armazenamento: ArmazenamentoEmMemoria;
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
  const armazenamento = new ArmazenamentoEmMemoria();
  const dependencias: DependenciasDoApp = {
    config,
    logger: criarLogger({ nivel: config.nivelLog, destino }),
    proxy,
    sessoes,
    armazenamento,
    auth: { senhas, agora: opcoes.agora, ...opcoes.auth },
    notificador: opcoes.notificador,
    notificadorDeRecuperacao: opcoes.notificadorDeRecuperacao,
    enviadorDeEmail: opcoes.enviadorDeEmail,
  };
  return {
    app: createApp(dependencias),
    proxy,
    sessoes,
    armazenamento,
    senhas,
    linhas,
    dependencias,
  };
}
