// UC10 — montagem do módulo de pedidos.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeClientes } from '../clientes/repositorio';
import { RepositorioDeProdutos } from '../produtos/repositorio';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import { RepositorioDePedidos } from './repositorio';
import { criarRotasDePedidos } from './rotas';
import { ServicoDePedidos, type MontadorDeOrcamentos } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDePedidos {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  /**
   * Cria o orçamento em RASCUNHO a partir do pedido aprovado (UC10 → UC14). Vem do módulo de
   * orçamentos, montado antes deste em `http/app.ts`.
   */
  readonly orcamentos: MontadorDeOrcamentos;
  readonly agora?: () => Date;
}

/** Módulo de pedidos montado. */
export interface ModuloDePedidos {
  readonly rotas: Router;
  readonly servico: ServicoDePedidos;
}

/** Cria os objetos do módulo de pedidos e liga uns aos outros. */
export function criarModuloDePedidos(dependencias: DependenciasDoModuloDePedidos): ModuloDePedidos {
  const servico = new ServicoDePedidos({
    pedidos: new RepositorioDePedidos(dependencias.proxy),
    clientes: new RepositorioDeClientes(dependencias.proxy),
    produtos: new RepositorioDeProdutos(dependencias.proxy),
    usuarios: new RepositorioDeUsuarios(dependencias.proxy),
    proxy: dependencias.proxy,
    orcamentos: dependencias.orcamentos,
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDePedidos({ servico, sessoes: dependencias.sessoes }), servico };
}
