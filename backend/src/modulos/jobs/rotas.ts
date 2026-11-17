// Item 9 do backend/TAREFAS.md — disparo manual/externo dos jobs agendados, para quem preferir
// um cron fora deste processo (ver `agendador.ts`).
import { createHash, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
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
  /** Segredo de máquina (JOBS_TOKEN). Ausente ou vazio: a via por token fica desligada. */
  readonly jobsToken?: string;
}

const PADRAO_DO_CABECALHO = /^Bearer ([^ ]+)$/;

function resumir(texto: string): Buffer {
  return createHash('sha256').update(texto).digest();
}

/**
 * Compara o token recebido com o esperado em tempo constante: os dois passam por SHA-256, o que
 * iguala o tamanho exigido por `timingSafeEqual` sem revelar o comprimento do segredo.
 */
export function tokenDeMaquinaConfere(recebido: string, esperado: string): boolean {
  return timingSafeEqual(resumir(recebido), resumir(esperado));
}

/**
 * Autoriza a requisição com `Authorization: Bearer <JOBS_TOKEN>` (cron externo) ou, se o token não
 * confere, cai na sessão de GESTOR/ADMIN. Sem JOBS_TOKEN configurado, só vale a sessão. O token
 * nunca é registrado em log.
 */
function exigirTokenDeMaquinaOuGestor(
  sessoes: RepositorioDeSessoes,
  jobsToken: string | undefined,
): RequestHandler {
  const autenticado = exigirSessao(sessoes);
  const somenteGestor = exigirPerfil('GESTOR');
  const sessaoDeGestor: RequestHandler = (req, res, next) => {
    autenticado(req, res, (erro?: unknown) => {
      if (erro !== undefined) {
        next(erro);
        return;
      }
      somenteGestor(req, res, next);
    });
  };
  if (jobsToken === undefined || jobsToken === '') {
    return sessaoDeGestor;
  }
  return (req, res, next) => {
    const recebido = PADRAO_DO_CABECALHO.exec(req.headers.authorization ?? '')?.[1];
    if (recebido !== undefined && tokenDeMaquinaConfere(recebido, jobsToken)) {
      next();
      return;
    }
    sessaoDeGestor(req, res, next);
  };
}

/**
 * `POST /jobs/executar`: dispara uma rodada imediata dos cinco jobs do item 9, fora do
 * agendamento periódico (UC20). Aceita a sessão de GESTOR/ADMIN ou, para um cron externo, o
 * `Authorization: Bearer <JOBS_TOKEN>`. Sem token ou com token errado: 401; perfil sem permissão:
 * 403. Não há tela para isto no frontend; é um gatilho de operação.
 */
export function criarRotasDeJobs({
  agendador,
  sessoes,
  jobsToken,
}: DependenciasDasRotasDeJobs): Router {
  const rotas = Router();
  const autorizado = exigirTokenDeMaquinaOuGestor(sessoes, jobsToken);

  rotas.post(
    ROTAS_DE_JOBS.EXECUTAR,
    autorizado,
    rotaAssincrona(async (_req, res) => {
      const resumo = await agendador.executar();
      res.status(STATUS_HTTP.OK).json({ resumo });
    }),
  );

  return rotas;
}
