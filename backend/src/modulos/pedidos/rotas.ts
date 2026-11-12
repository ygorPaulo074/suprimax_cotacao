// UC10 — rotas da fila de pedidos (docs/frontend-api.md, telas 2 e 3).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeParametroId } from '../comum/campos';
import { esquemaDeFiltroDePedidos, esquemaDeNegativa } from './esquemas';
import type { ServicoDePedidos } from './servico';

export const ROTAS_DE_PEDIDOS = {
  COLECAO: '/pedidos',
  ITEM: '/pedidos/:id',
  ASSUMIR: '/pedidos/:id/assumir',
  MONTAR_ORCAMENTO: '/pedidos/:id/montar-orcamento',
  NEGAR: '/pedidos/:id/negar',
} as const;

export interface DependenciasDasRotasDePedidos {
  readonly servico: ServicoDePedidos;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas da fila de pedidos, para OPERADOR e OPERADOR_CHEFE:
 * - `GET /pedidos?status=`: fila com os indicadores da tela 2;
 * - `GET /pedidos/:id`: detalhe do pedido (tela 3), com a situação de crédito do cliente;
 * - `POST /pedidos/:id/assumir`: `pedido.assumir` (SOLICITADO → EM_ANALISE);
 * - `POST /pedidos/:id/montar-orcamento`: cria o orçamento em RASCUNHO (UC10 → UC14);
 * - `POST /pedidos/:id/negar`: nega o pedido com o motivo informado.
 */
export function criarRotasDePedidos({ servico, sessoes }: DependenciasDasRotasDePedidos): Router {
  const rotas = Router();
  const operador = [exigirSessao(sessoes), exigirPerfil('OPERADOR', 'OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_PEDIDOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { status } = validarEntrada(esquemaDeFiltroDePedidos, req.query);
      res.status(STATUS_HTTP.OK).json(await servico.listarFila(obterSessao(res), status));
    }),
  );

  rotas.get(
    ROTAS_DE_PEDIDOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obterDetalhe(id, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_PEDIDOS.ASSUMIR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.assumir(id, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_PEDIDOS.MONTAR_ORCAMENTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.CRIADO).json(await servico.montarOrcamento(id, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_PEDIDOS.NEGAR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const { motivo } = validarEntrada(esquemaDeNegativa, req.body);
      await servico.negar(id, motivo, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  return rotas;
}
