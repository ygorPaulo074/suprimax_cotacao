// UC23 — rotas de dívidas (docs/frontend-api.md, tela 12).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import { esquemaDeParametroId } from '../comum/campos';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeDividaNova, esquemaDeRenegociacao } from './esquemas';
import type { ServicoDeDividas } from './servico';

export const ROTAS_DE_DIVIDAS = {
  COLECAO: '/dividas',
  RENEGOCIAR: '/dividas/:id/renegociar',
  QUITAR: '/dividas/:id/quitar',
} as const;

export interface DependenciasDasRotasDeDividas {
  readonly servico: ServicoDeDividas;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de dívidas, todas restritas ao perfil FINANCEIRO (UC23):
 * - `GET /dividas`: lista todas as dívidas;
 * - `POST /dividas`: registra uma dívida nova;
 * - `POST /dividas/:id/renegociar`: renegocia (mínimo 50% pago);
 * - `POST /dividas/:id/quitar`: marca como quitada (passo 5 da UC23; rota adicional, ainda não
 *   consumida pelo frontend atual — ver `docs/frontend-api.md`, "Pontos a confirmar").
 */
export function criarRotasDeDividas({ servico, sessoes }: DependenciasDasRotasDeDividas): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);
  const somenteFinanceiro = exigirPerfil('FINANCEIRO');

  rotas.get(
    ROTAS_DE_DIVIDAS.COLECAO,
    autenticado,
    somenteFinanceiro,
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json(await servico.listar());
    }),
  );

  rotas.post(
    ROTAS_DE_DIVIDAS.COLECAO,
    autenticado,
    somenteFinanceiro,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeDividaNova, req.body);
      const divida = await servico.registrar(dados, obterSessao(res));
      res.status(STATUS_HTTP.CRIADO).json(divida);
    }),
  );

  rotas.post(
    ROTAS_DE_DIVIDAS.RENEGOCIAR,
    autenticado,
    somenteFinanceiro,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeRenegociacao, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.renegociar(id, dados, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_DIVIDAS.QUITAR,
    autenticado,
    somenteFinanceiro,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.quitar(id, obterSessao(res)));
    }),
  );

  return rotas;
}
