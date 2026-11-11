// UC04 — rotas do cadastro de produtos (docs/frontend-api.md, tela 13).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeParametroId } from '../comum/campos';
import { esquemaDeListaDeProdutos, esquemaDeProdutoSalvar } from './esquemas';
import type { ServicoDeProdutos } from './servico';

export const ROTAS_DE_PRODUTOS = {
  COLECAO: '/produtos',
  ITEM: '/produtos/:id',
} as const;

export interface DependenciasDasRotasDeProdutos {
  readonly servico: ServicoDeProdutos;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de produtos, para OPERADOR e OPERADOR_CHEFE:
 * - `GET /produtos?q=`: lista, com busca por descrição, código interno ou EAN;
 * - `GET /produtos/:id`: o produto com variações e preços;
 * - `POST /produtos`: cadastro → 201 com o produto;
 * - `PUT /produtos/:id`: alteração → o produto atualizado.
 *
 * Faixas de preço e fardos só são aceitos de OPERADOR_CHEFE (`403 ACESSO_NEGADO`).
 */
export function criarRotasDeProdutos({ servico, sessoes }: DependenciasDasRotasDeProdutos): Router {
  const rotas = Router();
  const operador = [exigirSessao(sessoes), exigirPerfil('OPERADOR', 'OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_PRODUTOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { q } = validarEntrada(esquemaDeListaDeProdutos, req.query);
      res.status(STATUS_HTTP.OK).json(await servico.listar(q));
    }),
  );

  rotas.get(
    ROTAS_DE_PRODUTOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obter(id));
    }),
  );

  rotas.post(
    ROTAS_DE_PRODUTOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeProdutoSalvar, req.body);
      res.status(STATUS_HTTP.CRIADO).json(await servico.criar(dados, obterSessao(res)));
    }),
  );

  rotas.put(
    ROTAS_DE_PRODUTOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeProdutoSalvar, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.atualizar(id, dados, obterSessao(res)));
    }),
  );

  return rotas;
}
