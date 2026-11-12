// UC20, UC21 — montagem do módulo de respostas pendentes.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeOrcamentos } from '../orcamentos/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeRespostas } from './repositorio';
import { criarRotasDeRespostas } from './rotas';
import { ServicoDeRespostas, type GestorDeVersoesDeOrcamento } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeRespostas {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /** Implementado por `ServicoDeOrcamentos` (ver o comentário no topo de `./servico.ts`). */
  readonly gestorDeVersoes: GestorDeVersoesDeOrcamento;
  readonly agora?: () => Date;
}

/** Módulo de respostas pendentes montado. */
export interface ModuloDeRespostas {
  readonly rotas: Router;
  readonly servico: ServicoDeRespostas;
}

/** Cria os objetos do módulo de respostas e liga uns aos outros. */
export function criarModuloDeRespostas(
  dependencias: DependenciasDoModuloDeRespostas,
): ModuloDeRespostas {
  const servico = new ServicoDeRespostas({
    respostas: new RepositorioDeRespostas(dependencias.proxy),
    orcamentos: new RepositorioDeOrcamentos(dependencias.proxy),
    produtos: new RepositorioDeProdutos(dependencias.proxy),
    clientes: new RepositorioDeClientes(dependencias.proxy),
    usuarios: new RepositorioDeUsuarios(dependencias.proxy),
    gestorDeVersoes: dependencias.gestorDeVersoes,
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDeRespostas({ servico, sessoes: dependencias.sessoes }), servico };
}
