// UC22 — montagem do módulo de fornecedores.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeFornecedores } from './repositorio';
import { criarRotasDeFornecedores } from './rotas';
import { ServicoDeFornecedores } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeFornecedores {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
}

/** Módulo de fornecedores montado. */
export interface ModuloDeFornecedores {
  readonly rotas: Router;
  readonly servico: ServicoDeFornecedores;
}

/** Cria os objetos do módulo de fornecedores e liga uns aos outros. */
export function criarModuloDeFornecedores(
  dependencias: DependenciasDoModuloDeFornecedores,
): ModuloDeFornecedores {
  const servico = new ServicoDeFornecedores({
    fornecedores: new RepositorioDeFornecedores(dependencias.proxy),
    logger: dependencias.logger,
  });
  return { rotas: criarRotasDeFornecedores({ servico, sessoes: dependencias.sessoes }), servico };
}
