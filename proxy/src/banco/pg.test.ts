import type { Pool } from 'pg';
import { AppError } from '../erros';
import { ErroBanco } from './executor';
import { ExecutorPg } from './pg';

function montar() {
  const chamadas: string[] = [];
  const cliente = {
    query: jest.fn(async (texto: string) => {
      chamadas.push(texto);
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => cliente) } as unknown as Pool;
  return { executor: new ExecutorPg(pool), cliente, chamadas };
}

describe('ExecutorPg.transacao (RNF09)', () => {
  it('AppError de negócio sai intacto, com ROLLBACK e cliente liberado', async () => {
    const { executor, cliente, chamadas } = montar();
    const erro = new AppError('PEDIDO_JA_ASSUMIDO');
    await expect(
      executor.transacao(async () => {
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect(erro.codigo).toBe('PEDIDO_JA_ASSUMIDO');
    expect(erro.status).toBe(409);
    expect(chamadas).toEqual(['BEGIN', 'ROLLBACK']);
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('erro comum do driver ainda é traduzido para ErroBanco', async () => {
    const { executor, chamadas, cliente } = montar();
    await expect(
      executor.transacao(async () => {
        throw Object.assign(new Error('falhou'), { code: '23505' });
      }),
    ).rejects.toMatchObject({ name: 'ErroBanco', message: 'falhou' });
    await expect(
      executor.transacao(async () => {
        throw new Error('x');
      }),
    ).rejects.toBeInstanceOf(ErroBanco);
    expect(chamadas).toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledTimes(2);
  });

  it('sucesso faz COMMIT', async () => {
    const { executor, chamadas, cliente } = montar();
    expect(await executor.transacao(async () => 42)).toBe(42);
    expect(chamadas).toEqual(['BEGIN', 'COMMIT']);
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });
});
