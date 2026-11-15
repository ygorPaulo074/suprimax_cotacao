// UC13 — rotas de autenticação (docs/frontend-api.md, tela 1).
import { Router, type RequestHandler } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirSessao, obterSessao, obterTokenDaSessao } from '../../http/middlewares/autenticacao';
import { obterRequestId } from '../../http/middlewares/requestId';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import { esquemaDeLogin, esquemaDeRecuperarSenha, esquemaDeRedefinirSenha } from './esquemas';
import type { ServicoDeAutenticacao } from './servico';
import type { RepositorioDeSessoes } from './sessoes';

export const ROTAS_DE_AUTH = {
  LOGIN: '/auth/login',
  SESSAO_ATUAL: '/auth/me',
  LOGOUT: '/auth/logout',
  RECUPERAR_SENHA: '/auth/recuperar-senha',
  REDEFINIR_SENHA: '/auth/redefinir-senha',
} as const;

export interface DependenciasDasRotasDeAuth {
  readonly servico: ServicoDeAutenticacao;
  readonly sessoes: RepositorioDeSessoes;
  /** Limitador aplicado só ao login. */
  readonly limiteDeLogin: RequestHandler;
  /** Limitador aplicado só ao pedido de recuperação de senha. */
  readonly limiteDeRecuperacao: RequestHandler;
}

/**
 * Rotas de autenticação:
 * - `POST /auth/login`: `{ usuario, senha }` → `{ token, usuario }`;
 * - `GET /auth/me`: a sessão do token;
 * - `POST /auth/logout`: encerra a sessão, 204;
 * - `POST /auth/recuperar-senha`: `{ email }` → sempre 204 (UC13, RN01);
 * - `POST /auth/redefinir-senha`: `{ token, novaSenha }` → 204, ou 422 `TOKEN_RECUPERACAO_INVALIDO`.
 */
export function criarRotasDeAuth({
  servico,
  sessoes,
  limiteDeLogin,
  limiteDeRecuperacao,
}: DependenciasDasRotasDeAuth): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);

  rotas.post(
    ROTAS_DE_AUTH.LOGIN,
    limiteDeLogin,
    rotaAssincrona(async (req, res) => {
      const credenciais = validarEntrada(esquemaDeLogin, req.body);
      const resultado = await servico.entrar(credenciais, obterRequestId(res));
      res.status(STATUS_HTTP.OK).json(resultado);
    }),
  );

  rotas.get(ROTAS_DE_AUTH.SESSAO_ATUAL, autenticado, (_req, res) => {
    res.status(STATUS_HTTP.OK).json(obterSessao(res));
  });

  rotas.post(
    ROTAS_DE_AUTH.LOGOUT,
    autenticado,
    rotaAssincrona(async (_req, res) => {
      await servico.sair(obterTokenDaSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  rotas.post(
    ROTAS_DE_AUTH.RECUPERAR_SENHA,
    limiteDeRecuperacao,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeRecuperarSenha, req.body);
      await servico.recuperarSenha(dados);
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  rotas.post(
    ROTAS_DE_AUTH.REDEFINIR_SENHA,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeRedefinirSenha, req.body);
      await servico.redefinirSenha(dados);
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  return rotas;
}
