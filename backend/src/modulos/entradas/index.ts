// UC04 (passos 6-8) — montagem do módulo de entrada de mercadoria.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import { RepositorioDeOperadores } from '../auth/operadores';
import { ServicoDeSenha } from '../auth/senha';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeEstoque } from '../estoque/repositorio';
import { RepositorioDeFornecedores } from '../fornecedores/repositorio';
import { RepositorioDeEntradas } from './repositorio';
import { criarRotasDeEntradas } from './rotas';
import { ServicoDeEntradas } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeEntradas {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /** Mesma instância usada no login, para a liberação de divergência conferir com o mesmo custo. */
  readonly senhas?: ServicoDeSenha;
  readonly agora?: () => Date;
}

/** Módulo de entrada de mercadoria montado. */
export interface ModuloDeEntradas {
  readonly rotas: Router;
  readonly servico: ServicoDeEntradas;
}

/** Cria os objetos do módulo de entrada de mercadoria e liga uns aos outros. */
export function criarModuloDeEntradas(
  dependencias: DependenciasDoModuloDeEntradas,
): ModuloDeEntradas {
  const servico = new ServicoDeEntradas({
    entradas: new RepositorioDeEntradas(dependencias.proxy),
    fornecedores: new RepositorioDeFornecedores(dependencias.proxy),
    estoque: new RepositorioDeEstoque(dependencias.proxy),
    operadores: new RepositorioDeOperadores(dependencias.proxy),
    senhas: dependencias.senhas ?? new ServicoDeSenha(),
    proxy: dependencias.proxy,
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDeEntradas({ servico, sessoes: dependencias.sessoes }), servico };
}
