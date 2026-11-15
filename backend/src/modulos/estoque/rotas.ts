// UC24 — rotas de estoque (docs/frontend-api.md, tela 14).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeParametroId } from '../comum/campos';
import { esquemaDeAjusteEstoque } from './esquemas';
import type { ServicoDeEstoque } from './servico';

export const ROTAS_DE_ESTOQUE = {
  COLECAO: '/estoque/variacoes',
  ITEM: '/estoque/variacoes/:id',
  MOVIMENTACOES: '/estoque/variacoes/:id/movimentacoes',
  AJUSTES: '/estoque/variacoes/:id/ajustes',
} as const;

export interface DependenciasDasRotasDeEstoque {
  readonly servico: ServicoDeEstoque;
  readonly sessoes: RepositorioDeSessoes;
}

/** Rotas de estoque, todas restritas ao perfil OPERADOR_CHEFE (UC24). */
export function criarRotasDeEstoque({ servico, sessoes }: DependenciasDasRotasDeEstoque): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);
  const somenteChefe = exigirPerfil('OPERADOR_CHEFE');

  rotas.get(
    ROTAS_DE_ESTOQUE.COLECAO,
    autenticado,
    somenteChefe,
    rotaAssincrona(async (req, res) => {
      const termo = typeof req.query.q === 'string' ? req.query.q : undefined;
      res.status(STATUS_HTTP.OK).json(await servico.listarSaldo(termo));
    }),
  );

  rotas.get(
    ROTAS_DE_ESTOQUE.ITEM,
    autenticado,
    somenteChefe,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obterSaldo(id));
    }),
  );

  rotas.get(
    ROTAS_DE_ESTOQUE.MOVIMENTACOES,
    autenticado,
    somenteChefe,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.listarMovimentacoes(id));
    }),
  );

  rotas.post(
    ROTAS_DE_ESTOQUE.AJUSTES,
    autenticado,
    somenteChefe,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeAjusteEstoque, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.ajustar(id, dados, obterSessao(res)));
    }),
  );

  return rotas;
}
