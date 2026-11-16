// UC01, UC14-19 — montagem do módulo de orçamentos.
import type { Router } from 'express';
import type { DadosDaEmpresaEmissora } from '../../config';
import type { ClienteDeProxy } from '../../dados';
import { ArmazenamentoViaProxy, type ArmazenamentoDeArquivos } from '../../dados/armazenamento';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDeOrcamentos } from './repositorio';
import { criarRotasDeOrcamentos } from './rotas';
import { ServicoDeOrcamentos } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeOrcamentos {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /** Guarda os bytes dos anexos (UC19, RF11); por padrão, o Storage via proxy. */
  readonly armazenamento?: ArmazenamentoDeArquivos;
  /** Cabeçalho/rodapé do PDF de orçamento (UC19, docs/09). */
  readonly empresaEmissora: DadosDaEmpresaEmissora;
  readonly agora?: () => Date;
}

/** Módulo de orçamentos montado. */
export interface ModuloDeOrcamentos {
  readonly rotas: Router;
  readonly servico: ServicoDeOrcamentos;
}

/** Cria os objetos do módulo de orçamentos e liga uns aos outros. */
export function criarModuloDeOrcamentos(
  dependencias: DependenciasDoModuloDeOrcamentos,
): ModuloDeOrcamentos {
  const servico = new ServicoDeOrcamentos({
    orcamentos: new RepositorioDeOrcamentos(dependencias.proxy),
    clientes: new RepositorioDeClientes(dependencias.proxy),
    produtos: new RepositorioDeProdutos(dependencias.proxy),
    usuarios: new RepositorioDeUsuarios(dependencias.proxy),
    proxy: dependencias.proxy,
    armazenamento: dependencias.armazenamento ?? new ArmazenamentoViaProxy(dependencias.proxy),
    logger: dependencias.logger,
    empresaEmissora: dependencias.empresaEmissora,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDeOrcamentos({ servico, sessoes: dependencias.sessoes }), servico };
}
