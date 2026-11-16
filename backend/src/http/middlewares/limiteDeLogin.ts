// UC13 — limite de tentativas de login e de pedidos de recuperação de senha por endereço IP.
// Complementa o bloqueio por conta: segura quem tenta muitas contas diferentes a partir do mesmo
// endereço.
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ErroDeLimiteExcedido } from '../../erros';

/** Janela de contagem das tentativas. */
export const JANELA_DO_LIMITE_DE_LOGIN_MS = 15 * 60 * 1000;
/** Tentativas malsucedidas por IP dentro da janela. Logins bem-sucedidos não contam. */
export const MAXIMO_DE_FALHAS_DE_LOGIN_POR_IP = 20;
/** Janela de contagem dos pedidos de recuperação de senha. */
export const JANELA_DO_LIMITE_DE_RECUPERACAO_MS = 15 * 60 * 1000;
/**
 * Pedidos de recuperação de senha por IP dentro da janela. `POST /auth/recuperar-senha` sempre
 * responde 204 (não revela se o e-mail existe), então, diferente do login, toda chamada conta —
 * sem isso, o limite não protegeria contra um e-mail cadastrado sendo bombardeado de links.
 */
export const MAXIMO_DE_PEDIDOS_DE_RECUPERACAO_POR_IP = 5;

export interface OpcoesDoLimiteDeLogin {
  readonly janelaMs?: number;
  readonly maximoDeFalhas?: number;
}

/**
 * Cria o limitador de `POST /auth/login`. Ao passar do limite, responde `429 LIMITE_EXCEDIDO` no
 * formato padrão de erro.
 *
 * Só as tentativas que falham contam, porque vários operadores do mesmo escritório costumam sair
 * pelo mesmo IP. O IP considerado depende de `TRUST_PROXY` (config).
 */
export function limiteDeLogin(opcoes: OpcoesDoLimiteDeLogin = {}): RequestHandler {
  return rateLimit({
    windowMs: opcoes.janelaMs ?? JANELA_DO_LIMITE_DE_LOGIN_MS,
    limit: opcoes.maximoDeFalhas ?? MAXIMO_DE_FALHAS_DE_LOGIN_POR_IP,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new ErroDeLimiteExcedido()),
  });
}

export interface OpcoesDoLimiteDeRecuperacao {
  readonly janelaMs?: number;
  readonly maximoDePedidos?: number;
}

/**
 * Cria o limitador de `POST /auth/recuperar-senha`. Ao passar do limite, responde
 * `429 LIMITE_EXCEDIDO` no formato padrão de erro.
 */
export function limiteDeRecuperacaoDeSenha(
  opcoes: OpcoesDoLimiteDeRecuperacao = {},
): RequestHandler {
  return rateLimit({
    windowMs: opcoes.janelaMs ?? JANELA_DO_LIMITE_DE_RECUPERACAO_MS,
    limit: opcoes.maximoDePedidos ?? MAXIMO_DE_PEDIDOS_DE_RECUPERACAO_POR_IP,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new ErroDeLimiteExcedido()),
  });
}
