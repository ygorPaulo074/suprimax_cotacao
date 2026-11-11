// UC13 — rotas de autenticação (docs/frontend-api.md, tela 1).
import { Router, type RequestHandler } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirSessao, obterSessao, obterTokenDaSessao } from '../../http/middlewares/autenticacao';
import { obterRequestId } from '../../http/middlewares/requestId';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { esquemaDeLogin, validarCorpo } from './esquemas';
import type { ServicoDeAutenticacao } from './servico';
import type { RepositorioDeSessoes } from './sessoes';

export const ROTAS_DE_AUTH = {
  LOGIN: '/auth/login',
  SESSAO_ATUAL: '/auth/me',
  LOGOUT: '/auth/logout',
} as const;

const CABECALHO_DE_CACHE = 'Cache-Control';
const SEM_CACHE = 'no-store';

export interface DependenciasDasRotasDeAuth {
  readonly servico: ServicoDeAutenticacao;
  readonly sessoes: RepositorioDeSessoes;
  /** Limitador aplicado só ao login. */
  readonly limiteDeLogin: RequestHandler;
}

/**
 * Rotas de autenticação:
 * - `POST /auth/login`: `{ usuario, senha }` → `{ token, usuario }`;
 * - `GET /auth/me`: a sessão do token;
 * - `POST /auth/logout`: encerra a sessão, 204.
 */
export function criarRotasDeAuth({
  servico,
  sessoes,
  limiteDeLogin,
}: DependenciasDasRotasDeAuth): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);

  rotas.post(
    ROTAS_DE_AUTH.LOGIN,
    limiteDeLogin,
    rotaAssincrona(async (req, res) => {
      const credenciais = validarCorpo(esquemaDeLogin, req.body);
      const resultado = await servico.entrar(credenciais, obterRequestId(res));
      res.setHeader(CABECALHO_DE_CACHE, SEM_CACHE).status(STATUS_HTTP.OK).json(resultado);
    }),
  );

  rotas.get(ROTAS_DE_AUTH.SESSAO_ATUAL, autenticado, (_req, res) => {
    res.setHeader(CABECALHO_DE_CACHE, SEM_CACHE).status(STATUS_HTTP.OK).json(obterSessao(res));
  });

  rotas.post(
    ROTAS_DE_AUTH.LOGOUT,
    autenticado,
    rotaAssincrona(async (_req, res) => {
      await servico.sair(obterTokenDaSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  return rotas;
}
