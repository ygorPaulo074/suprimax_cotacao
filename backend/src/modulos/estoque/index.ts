// UC24 — montagem do módulo de estoque.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeEstoque } from './repositorio';
import { criarRotasDeEstoque } from './rotas';
import { ServicoDeEstoque } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeEstoque {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
}

/** Módulo de estoque montado. */
export interface ModuloDeEstoque {
  readonly rotas: Router;
  readonly servico: ServicoDeEstoque;
}

/** Cria os objetos do módulo de estoque e liga uns aos outros. */
export function criarModuloDeEstoque(dependencias: DependenciasDoModuloDeEstoque): ModuloDeEstoque {
  const servico = new ServicoDeEstoque({
    estoque: new RepositorioDeEstoque(dependencias.proxy),
    usuarios: new RepositorioDeUsuarios(dependencias.proxy),
    proxy: dependencias.proxy,
    logger: dependencias.logger,
  });
  return { rotas: criarRotasDeEstoque({ servico, sessoes: dependencias.sessoes }), servico };
}
