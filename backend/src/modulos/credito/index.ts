// UC07 — montagem do módulo de análise de crédito.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import { RepositorioDeClientes } from '../clientes/repositorio';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { RepositorioDeAnalisesDeCredito } from './repositorio';
import { criarRotasDeCredito } from './rotas';
import { ServicoDeAnaliseCredito, type GestorDeOrcamentoParaCredito } from './servico';

export * from './esquemas';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeCredito {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  readonly agora?: () => Date;
  /** `ServicoDeOrcamentos`, montado antes deste módulo (ver `app.ts`). */
  readonly gestorDeOrcamento: GestorDeOrcamentoParaCredito;
}

/** Módulo de análise de crédito montado. */
export interface ModuloDeCredito {
  readonly rotas: Router;
  readonly servico: ServicoDeAnaliseCredito;
}

/**
 * Cria os objetos do módulo de crédito e liga uns aos outros. Quem monta o app ainda precisa
 * chamar `orcamentos.servico.definirGestorDeAnaliseCredito(credito.servico)` depois — a outra
 * metade da ligação de duas vias entre os dois módulos.
 */
export function criarModuloDeCredito(dependencias: DependenciasDoModuloDeCredito): ModuloDeCredito {
  const servico = new ServicoDeAnaliseCredito({
    analises: new RepositorioDeAnalisesDeCredito(dependencias.proxy),
    clientes: new RepositorioDeClientes(dependencias.proxy),
    gestorDeOrcamento: dependencias.gestorDeOrcamento,
    logger: dependencias.logger,
    agora: dependencias.agora,
  });
  return { rotas: criarRotasDeCredito({ servico, sessoes: dependencias.sessoes }), servico };
}
