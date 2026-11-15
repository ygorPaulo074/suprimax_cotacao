// UC13 — montagem do módulo de autenticação.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import {
  limiteDeLogin,
  limiteDeRecuperacaoDeSenha,
  type OpcoesDoLimiteDeLogin,
  type OpcoesDoLimiteDeRecuperacao,
} from '../../http/middlewares/limiteDeLogin';
import type { Logger } from '../../log';
import {
  NotificadorDeRecuperacaoDeSenhaMudo,
  type NotificadorDeRecuperacaoDeSenha,
} from './notificador';
import { RepositorioDeOperadores } from './operadores';
import { criarRotasDeAuth } from './rotas';
import { ServicoDeSenha } from './senha';
import { ServicoDeAutenticacao } from './servico';
import type { RepositorioDeSessoes } from './sessoes';

export * from './notificador';
export * from './operadores';
export * from './rotas';
export * from './senha';
export * from './servico';
export * from './sessoes';
export * from './tokenDeSenha';

export interface DependenciasDoModuloDeAuth {
  readonly proxy: ClienteDeProxy;
  /** Repositório compartilhado com os demais módulos, que o usam em `exigirSessao`. */
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /** Por padrão, bcrypt com o custo de produção. */
  readonly senhas?: ServicoDeSenha;
  readonly limiteDeLogin?: OpcoesDoLimiteDeLogin;
  readonly limiteDeRecuperacao?: OpcoesDoLimiteDeRecuperacao;
  /** Envio do e-mail de recuperação de senha; por padrão, o notificador que só registra em log. */
  readonly notificador?: NotificadorDeRecuperacaoDeSenha;
  readonly agora?: () => Date;
}

/** Módulo de autenticação montado. */
export interface ModuloDeAuth {
  readonly rotas: Router;
  readonly servico: ServicoDeAutenticacao;
}

/** Cria os objetos do módulo de autenticação e liga uns aos outros. */
export function criarModuloDeAuth(dependencias: DependenciasDoModuloDeAuth): ModuloDeAuth {
  const servico = new ServicoDeAutenticacao({
    operadores: new RepositorioDeOperadores(dependencias.proxy),
    sessoes: dependencias.sessoes,
    senhas: dependencias.senhas ?? new ServicoDeSenha(),
    logger: dependencias.logger,
    notificador:
      dependencias.notificador ?? new NotificadorDeRecuperacaoDeSenhaMudo(dependencias.logger),
    agora: dependencias.agora,
  });
  const rotas = criarRotasDeAuth({
    servico,
    sessoes: dependencias.sessoes,
    limiteDeLogin: limiteDeLogin(dependencias.limiteDeLogin),
    limiteDeRecuperacao: limiteDeRecuperacaoDeSenha(dependencias.limiteDeRecuperacao),
  });
  return { rotas, servico };
}
