// UC02 e UC03 — montagem do módulo de clientes.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeClientes } from './repositorio';
import { criarRotasDeClientes } from './rotas';
import { ServicoDeClientes, type LeitorDeOrcamentosDoCliente } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeClientes {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /** Orçamentos em aberto e histórico de compras do cliente (RF04). */
  readonly orcamentos: LeitorDeOrcamentosDoCliente;
  readonly agora?: () => Date;
}

/** Módulo de clientes montado. */
export interface ModuloDeClientes {
  readonly rotas: Router;
  readonly servico: ServicoDeClientes;
}

/** Cria os objetos do módulo de clientes e liga uns aos outros. */
export function criarModuloDeClientes(
  dependencias: DependenciasDoModuloDeClientes,
): ModuloDeClientes {
  const servico = new ServicoDeClientes({
    clientes: new RepositorioDeClientes(dependencias.proxy),
    usuarios: new RepositorioDeUsuarios(dependencias.proxy),
    orcamentos: dependencias.orcamentos,
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDeClientes({ servico, sessoes: dependencias.sessoes }), servico };
}
