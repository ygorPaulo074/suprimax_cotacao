// RF17 — rota do resumo de indicadores para o painel do Sistema 3 (UC09).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import type { ServicoDeIndicadores } from './servico';

export const ROTAS_DE_INDICADORES = {
  RESUMO: '/indicadores',
} as const;

export interface DependenciasDasRotasDeIndicadores {
  readonly servico: ServicoDeIndicadores;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * `GET /indicadores`: resumo de indicadores de BI (RF17), restrito ao perfil GESTOR — o login é
 * o mesmo das outras rotas (RF08, "login unificado com o Sistema 1 e o Sistema 3"); o Sistema 2
 * só disponibiliza os números, a renderização do painel é do Sistema 3 (docs/11, seção 11.2).
 */
export function criarRotasDeIndicadores({
  servico,
  sessoes,
}: DependenciasDasRotasDeIndicadores): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);
  const somenteGestor = exigirPerfil('GESTOR');

  rotas.get(
    ROTAS_DE_INDICADORES.RESUMO,
    autenticado,
    somenteGestor,
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json(await servico.obterResumo());
    }),
  );

  return rotas;
}
