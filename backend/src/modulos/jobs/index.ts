// Item 9 do backend/TAREFAS.md — montagem do módulo de jobs agendados.
import type { Router } from 'express';
import type { ClienteDeProxy } from '../../dados';
import type { Logger } from '../../log';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { AgendadorDeJobs } from './agendador';
import { RepositorioDeJobs } from './repositorio';
import { criarRotasDeJobs } from './rotas';
import { ServicoDeJobsAgendados } from './servico';

export * from './agendador';
export * from './repositorio';
export * from './rotas';
export * from './servico';

export interface DependenciasDoModuloDeJobs {
  readonly proxy: ClienteDeProxy;
  readonly sessoes: RepositorioDeSessoes;
  readonly logger: Logger;
  readonly agora?: () => Date;
  /** Intervalo entre rodadas do agendador in-process; por padrão, `INTERVALO_PADRAO_MINUTOS`. */
  readonly intervaloDoAgendadorMs?: number;
  /** Segredo de máquina de `POST /jobs/executar`; sem ele, só a sessão de GESTOR/ADMIN vale. */
  readonly jobsToken?: string;
  /** UC20: processa as respostas PENDENTE a cada rodada (`ServicoDeRespostas.processarPendentes`). */
  readonly processarRespostasPendentes?: () => Promise<number>;
}

/** Módulo de jobs agendados montado. */
export interface ModuloDeJobs {
  readonly rotas: Router;
  readonly servico: ServicoDeJobsAgendados;
  /** Não é ligado aqui — quem decide se o agendador in-process roda é `index.ts` (`principal`). */
  readonly agendador: AgendadorDeJobs;
}

/** Cria os objetos do módulo de jobs agendados e liga uns aos outros. */
export function criarModuloDeJobs(dependencias: DependenciasDoModuloDeJobs): ModuloDeJobs {
  const servico = new ServicoDeJobsAgendados({
    jobs: new RepositorioDeJobs(dependencias.proxy),
    logger: dependencias.logger,
    agora: dependencias.agora,
    processarRespostasPendentes: dependencias.processarRespostasPendentes,
  });
  const agendador = new AgendadorDeJobs({
    servico,
    logger: dependencias.logger,
    intervaloMs: dependencias.intervaloDoAgendadorMs,
  });
  return {
    rotas: criarRotasDeJobs({
      agendador,
      sessoes: dependencias.sessoes,
      jobsToken: dependencias.jobsToken,
    }),
    servico,
    agendador,
  };
}
