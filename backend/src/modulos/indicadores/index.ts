// RF17 — montagem do módulo de indicadores de BI.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeIndicadores } from './repositorio';
import { criarRotasDeIndicadores } from './rotas';
import { ServicoDeIndicadores } from './servico';

export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeIndicadores {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Módulo de indicadores de BI montado. */
export interface ModuloDeIndicadores {
  readonly rotas: Router;
  readonly servico: ServicoDeIndicadores;
}

/** Cria os objetos do módulo de indicadores e liga uns aos outros. */
export function criarModuloDeIndicadores(
  dependencias: DependenciasDoModuloDeIndicadores,
): ModuloDeIndicadores {
  const servico = new ServicoDeIndicadores({
    indicadores: new RepositorioDeIndicadores(dependencias.proxy),
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return {
    rotas: criarRotasDeIndicadores({ servico, sessoes: dependencias.sessoes }),
    servico,
  };
}
