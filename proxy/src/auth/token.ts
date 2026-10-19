import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '../erros';

// Token de integrante (docs/12, seção 12.3): JWT com service_id, escopos, origens, iat e exp.

export interface ClaimsIntegrante {
  service_id: string;
  escopos: string[];
  origens: string[];
  iat: number;
  exp: number;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function novoServiceId(): string {
  return randomUUID();
}

export function emitirToken(
  segredo: string,
  dados: { serviceId: string; escopos: string[]; origens?: string[]; expiraEm: Date },
): string {
  return jwt.sign(
    {
      service_id: dados.serviceId,
      escopos: dados.escopos,
      origens: dados.origens ?? [],
      exp: Math.floor(dados.expiraEm.getTime() / 1000),
    },
    segredo,
    { algorithm: 'HS256' },
  );
}

/** Confere assinatura e validade. Qualquer falha vira TOKEN_INVALIDO, sem dizer o motivo ao cliente. */
export function verificarToken(segredo: string, token: string): ClaimsIntegrante {
  try {
    const claims = jwt.verify(token, segredo, { algorithms: ['HS256'] });
    if (
      typeof claims === 'string' ||
      typeof claims.service_id !== 'string' ||
      !Array.isArray(claims.escopos)
    ) {
      throw new Error('claims fora do formato');
    }
    return claims as ClaimsIntegrante;
  } catch (e) {
    throw new AppError('TOKEN_INVALIDO', undefined, e instanceof Error ? e.message : String(e));
  }
}
