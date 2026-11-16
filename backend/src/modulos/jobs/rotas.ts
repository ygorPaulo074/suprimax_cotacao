// Item 9 do backend/TAREFAS.md — disparo manual/externo dos jobs agendados, para quem preferir
// um cron fora deste processo (ver `agendador.ts`).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import type { AgendadorDeJobs } from './agendador';

export const ROTAS_DE_JOBS = {
  EXECUTAR: '/jobs/executar',
} as const;

export interface DependenciasDasRotasDeJobs {
  readonly agendador: AgendadorDeJobs;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * `POST /jobs/executar`: dispara uma rodada imediata dos cinco jobs do item 9, fora do
 * agendamento periódico. Restrita a GESTOR, como `/indicadores` — não há tela para isto no
 * frontend; é um gatilho de operação (um cron externo ou alguém da equipe).
 */
export function criarRotasDeJobs({ agendador, sessoes }: DependenciasDasRotasDeJobs): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);
  const somenteGestor = exigirPerfil('GESTOR');

  rotas.post(
    ROTAS_DE_JOBS.EXECUTAR,
    autenticado,
    somenteGestor,
    rotaAssincrona(async (_req, res) => {
      const resumo = await agendador.executar();
      res.status(STATUS_HTTP.OK).json({ resumo });
    }),
  );

  return rotas;
}
