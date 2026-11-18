// UC13 — exige sessão válida e perfil autorizado nas rotas. Esconder um item do menu é só
// conveniência do frontend: a autorização é conferida aqui (docs/10, seção 10.2).
import type { RequestHandler, Response } from 'express';
import { executarComoOperador } from '../../dados/usuarioDaRequisicao';
import { ErroDeAcessoNegado, ErroNaoAutenticado } from '../../erros';
import {
  PERFIL_ADMIN,
  type Perfil,
  type RepositorioDeSessoes,
  type Sessao,
} from '../../modulos/auth/sessoes';
import { rotaAssincrona } from '../rotaAssincrona';

const CHAVE_LOCAL_SESSAO = 'sessao';
const CHAVE_LOCAL_TOKEN = 'tokenDeSessao';
const PADRAO_DO_CABECALHO = /^Bearer (\S+)$/;

/**
 * Exige `Authorization: Bearer <token>` com uma sessão válida, cujo prazo é renovado a cada uso.
 * Sem cabeçalho, com formato errado ou com sessão inexistente ou expirada: `401 NAO_AUTENTICADO`.
 * O restante da requisição roda em nome do operador da sessão: o cliente do proxy o envia em
 * X-User-Id para a auditoria (`executarComoOperador`).
 */
export function exigirSessao(sessoes: RepositorioDeSessoes): RequestHandler {
  return rotaAssincrona(async (req, res, next) => {
    const token = PADRAO_DO_CABECALHO.exec(req.headers.authorization ?? '')?.[1];
    const sessao = token === undefined ? null : await sessoes.buscar(token);
    if (!sessao) {
      throw new ErroNaoAutenticado();
    }
    res.locals[CHAVE_LOCAL_SESSAO] = sessao;
    res.locals[CHAVE_LOCAL_TOKEN] = token;
    executarComoOperador(sessao.idOperador, () => next());
  });
}

/**
 * Exige que o perfil da sessão esteja entre os informados; senão, `403 ACESSO_NEGADO`.
 * O perfil ADMIN passa sempre (acesso total), sem precisar constar da lista.
 * Use depois de `exigirSessao`.
 */
export function exigirPerfil(...perfis: readonly Perfil[]): RequestHandler {
  return (_req, res, next) => {
    const { perfil } = obterSessao(res);
    next(perfil === PERFIL_ADMIN || perfis.includes(perfil) ? undefined : new ErroDeAcessoNegado());
  };
}

/**
 * Sessão da requisição atual.
 *
 * @throws {ErroNaoAutenticado} Se a rota não passou por `exigirSessao`.
 */
export function obterSessao(res: Response): Sessao {
  const sessao = res.locals[CHAVE_LOCAL_SESSAO] as Sessao | undefined;
  if (!sessao) {
    throw new ErroNaoAutenticado();
  }
  return sessao;
}

/**
 * Token da sessão da requisição atual, para o logout.
 *
 * @throws {ErroNaoAutenticado} Se a rota não passou por `exigirSessao`.
 */
export function obterTokenDaSessao(res: Response): string {
  const token: unknown = res.locals[CHAVE_LOCAL_TOKEN];
  if (typeof token !== 'string') {
    throw new ErroNaoAutenticado();
  }
  return token;
}
