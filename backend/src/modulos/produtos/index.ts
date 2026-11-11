// UC04 — montagem do módulo de produtos.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeProdutos } from './repositorio';
import { criarRotasDeProdutos } from './rotas';
import { ServicoDeProdutos } from './servico';

export * from './esquemas';
export * from './plano';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeProdutos {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
}

/** Módulo de produtos montado. */
export interface ModuloDeProdutos {
  readonly rotas: Router;
  readonly servico: ServicoDeProdutos;
}

/** Cria os objetos do módulo de produtos e liga uns aos outros. */
export function criarModuloDeProdutos(
  dependencias: DependenciasDoModuloDeProdutos,
): ModuloDeProdutos {
  const servico = new ServicoDeProdutos({
    produtos: new RepositorioDeProdutos(dependencias.proxy),
    logger: dependencias.logger,
  });
  return { rotas: criarRotasDeProdutos({ servico, sessoes: dependencias.sessoes }), servico };
}
