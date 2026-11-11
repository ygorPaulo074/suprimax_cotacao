// UC25 — rotas da gestão de usuários (docs/frontend-api.md, tela 17). Só o operador chefe.
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeParametroId } from '../comum/campos';
import { esquemaDeUsuarioAtualizar, esquemaDeUsuarioNovo } from './esquemas';
import type { ServicoDeUsuarios } from './servico';

export const ROTAS_DE_USUARIOS = {
  COLECAO: '/usuarios',
  ITEM: '/usuarios/:id',
} as const;

export interface DependenciasDasRotasDeUsuarios {
  readonly servico: ServicoDeUsuarios;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de usuários, todas restritas a OPERADOR_CHEFE:
 * - `GET /usuarios`: lista com o tamanho da carteira de cada um;
 * - `POST /usuarios`: `{ usuario, email, perfil }` → 201 com o usuário criado;
 * - `PATCH /usuarios/:id`: `{ perfil?, status?, idNovoVendedor? }` → o usuário alterado.
 */
export function criarRotasDeUsuarios({ servico, sessoes }: DependenciasDasRotasDeUsuarios): Router {
  const rotas = Router();
  const chefe = [exigirSessao(sessoes), exigirPerfil('OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_USUARIOS.COLECAO,
    chefe,
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json(await servico.listar());
    }),
  );

  rotas.post(
    ROTAS_DE_USUARIOS.COLECAO,
    chefe,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeUsuarioNovo, req.body);
      res.status(STATUS_HTTP.CRIADO).json(await servico.criar(dados, obterSessao(res)));
    }),
  );

  rotas.patch(
    ROTAS_DE_USUARIOS.ITEM,
    chefe,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeUsuarioAtualizar, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.atualizar(id, dados, obterSessao(res)));
    }),
  );

  return rotas;
}
