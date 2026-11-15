// UC23 — montagem do módulo de dívidas.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import { RepositorioDeClientes } from '../clientes/repositorio';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeDividas } from './repositorio';
import { criarRotasDeDividas } from './rotas';
import { ServicoDeDividas } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeDividas {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
}

/** Módulo de dívidas montado. */
export interface ModuloDeDividas {
  readonly rotas: Router;
  readonly servico: ServicoDeDividas;
}

/** Cria os objetos do módulo de dívidas e liga uns aos outros. */
export function criarModuloDeDividas(dependencias: DependenciasDoModuloDeDividas): ModuloDeDividas {
  const servico = new ServicoDeDividas({
    dividas: new RepositorioDeDividas(dependencias.proxy),
    clientes: new RepositorioDeClientes(dependencias.proxy),
    logger: dependencias.logger,
  });
  return { rotas: criarRotasDeDividas({ servico, sessoes: dependencias.sessoes }), servico };
}
