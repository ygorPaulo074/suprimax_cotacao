// UC13 — limite de tentativas de login por endereço IP. Complementa o bloqueio por conta: segura
// quem tenta muitas contas diferentes a partir do mesmo endereço.
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ErroDeLimiteExcedido } from '../../erros';

/** Janela de contagem das tentativas. */
export const JANELA_DO_LIMITE_DE_LOGIN_MS = 15 * 60 * 1000;
/** Tentativas malsucedidas por IP dentro da janela. Logins bem-sucedidos não contam. */
export const MAXIMO_DE_FALHAS_DE_LOGIN_POR_IP = 20;

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
