import { createHash } from 'node:crypto';
import { BYTES_DO_TOKEN_DE_SENHA, gerarTokenDeSenha, resumoDoTokenDeSenha } from './tokenDeSenha';

const AGORA = new Date('2026-11-11T15:00:00Z');
const UMA_HORA_MS = 60 * 60 * 1000;

describe('gerarTokenDeSenha', () => {
  it('gera um token de 256 bits em base64url, com o resumo SHA-256 e a validade pedida', () => {
    const { token, resumo, validade } = gerarTokenDeSenha(UMA_HORA_MS, AGORA);

    expect(Buffer.from(token, 'base64url')).toHaveLength(BYTES_DO_TOKEN_DE_SENHA);
    expect(token).toMatch(/^[\w-]+$/);
    expect(resumo).toBe(createHash('sha256').update(token).digest('hex'));
    expect(resumo).not.toContain(token);
    expect(validade).toEqual(new Date('2026-11-11T16:00:00Z'));
  });

  it('nunca repete um token', () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => gerarTokenDeSenha(UMA_HORA_MS, AGORA).token),
    );

    expect(tokens.size).toBe(200);
  });
});

describe('resumoDoTokenDeSenha', () => {
  it('devolve sempre o mesmo resumo para o mesmo token, e resumos diferentes para tokens diferentes', () => {
    expect(resumoDoTokenDeSenha('abc')).toBe(resumoDoTokenDeSenha('abc'));
    expect(resumoDoTokenDeSenha('abc')).not.toBe(resumoDoTokenDeSenha('abd'));
    expect(resumoDoTokenDeSenha('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
