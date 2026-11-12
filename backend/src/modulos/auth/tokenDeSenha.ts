// UC25 e UC13 — token de uso único do link de definição e de recuperação de senha. O banco guarda
// só o SHA-256 do token (coluna `token_recuperacao_senha`): quem ler a tabela não consegue montar
// o link. O texto puro existe apenas no e-mail enviado ao usuário.
import { createHash, randomBytes } from 'node:crypto';

/** Bytes aleatórios do token (256 bits). */
export const BYTES_DO_TOKEN_DE_SENHA = 32;

const ALGORITMO_DO_RESUMO = 'sha256';
const CODIFICACAO_DO_TOKEN = 'base64url';
const CODIFICACAO_DO_RESUMO = 'hex';

/** Token recém-gerado. */
export interface TokenDeSenha {
  /** Texto puro, que vai só no link enviado por e-mail. Nunca grave nem registre em log. */
  readonly token: string;
  /** O que é gravado em `token_recuperacao_senha`. */
  readonly resumo: string;
  /** Momento em que o token deixa de valer (`validade_token`). */
  readonly validade: Date;
}

/** Resumo com que um token recebido é procurado no banco. */
export function resumoDoTokenDeSenha(token: string): string {
  return createHash(ALGORITMO_DO_RESUMO).update(token).digest(CODIFICACAO_DO_RESUMO);
}

/**
 * Gera um token aleatório de uso único.
 *
 * @param duracaoMs Por quanto tempo o token vale.
 * @param agora Momento da geração.
 */
export function gerarTokenDeSenha(duracaoMs: number, agora: Date): TokenDeSenha {
  const token = randomBytes(BYTES_DO_TOKEN_DE_SENHA).toString(CODIFICACAO_DO_TOKEN);
  return {
    token,
    resumo: resumoDoTokenDeSenha(token),
    validade: new Date(agora.getTime() + duracaoMs),
  };
}
