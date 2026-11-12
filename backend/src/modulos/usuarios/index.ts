// UC25 — montagem do módulo de usuários.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import { ServicoDeSenha } from '../auth/senha';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { NotificadorDeEmailMudo, type NotificadorDeEmail } from './notificador';
import { RepositorioDeUsuarios } from './repositorio';
import { criarRotasDeUsuarios } from './rotas';
import { ServicoDeUsuarios } from './servico';

export * from './esquemas';
export * from './notificador';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeUsuarios {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /** Por padrão, bcrypt com o custo de produção. */
  readonly senhas?: ServicoDeSenha;
  /** Por padrão, o notificador que só registra em log. */
  readonly notificador?: NotificadorDeEmail;
  readonly agora?: () => Date;
}

/** Módulo de usuários montado. */
export interface ModuloDeUsuarios {
  readonly rotas: Router;
  readonly servico: ServicoDeUsuarios;
}

/** Cria os objetos do módulo de usuários e liga uns aos outros. */
export function criarModuloDeUsuarios(
  dependencias: DependenciasDoModuloDeUsuarios,
): ModuloDeUsuarios {
  const servico = new ServicoDeUsuarios({
    usuarios: new RepositorioDeUsuarios(dependencias.proxy),
    senhas: dependencias.senhas ?? new ServicoDeSenha(),
    sessoes: dependencias.sessoes,
    notificador: dependencias.notificador ?? new NotificadorDeEmailMudo(dependencias.logger),
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDeUsuarios({ servico, sessoes: dependencias.sessoes }), servico };
}
