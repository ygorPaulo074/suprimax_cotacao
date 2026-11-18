import { Pool } from 'pg';

jest.mock('pg', () => {
  const real = jest.requireActual('pg');
  return { ...real, Pool: jest.fn().mockImplementation(() => ({ on: jest.fn(), end: jest.fn() })) };
});
import { AppError } from '../erros';
import { ErroBanco } from './executor';
import {
  CONNECTION_TIMEOUT_MS,
  ExecutorPg,
  LOCK_TIMEOUT_MS,
  STATEMENT_TIMEOUT_MS,
  criarExecutorPg,
} from './pg';

const TIMEOUTS = [
  `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
  `SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`,
];

function montar() {
  const chamadas: string[] = [];
  const cliente = {
    query: jest.fn(async (texto: string) => {
      chamadas.push(texto);
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => cliente) } as unknown as import('pg').Pool;
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
    expect(chamadas).toEqual(['BEGIN', ...TIMEOUTS, 'ROLLBACK']);
    expect(cliente.release).toHaveBeenCalledWith(undefined);
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
    expect(chamadas).toEqual(['BEGIN', ...TIMEOUTS, 'COMMIT']);
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('os tempos limite vêm logo após o BEGIN, antes de qualquer comando da tarefa', async () => {
    const { executor, chamadas } = montar();
    await executor.transacao(async (tx) => {
      await tx.consultar({ texto: 'SELECT 1', valores: [] });
    });
    expect(chamadas).toEqual(['BEGIN', ...TIMEOUTS, 'SELECT 1', 'COMMIT']);
    expect(STATEMENT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LOCK_TIMEOUT_MS).toBeLessThan(STATEMENT_TIMEOUT_MS);
  });

  it('se o ROLLBACK falha, a conexão é destruída (release com erro) e o erro original sai', async () => {
    const { executor, cliente } = montar();
    const quebra = new Error('conexão caiu');
    cliente.query.mockImplementation(async (texto: string) => {
      if (texto === 'ROLLBACK') throw quebra;
      return { rows: [], rowCount: 0 };
    });
    const erro = new AppError('PEDIDO_JA_ASSUMIDO');
    await expect(
      executor.transacao(async () => {
        throw erro;
      }),
    ).rejects.toBe(erro);
    expect(cliente.release).toHaveBeenCalledWith(quebra);
  });
});

describe('criarExecutorPg', () => {
  it('limita a espera por conexão e trata erro de conexão ociosa', () => {
    criarExecutorPg('postgres://x');
    const opcoes = (Pool as unknown as jest.Mock).mock.calls.at(-1)?.[0];
    expect(opcoes).toMatchObject({ connectionTimeoutMillis: CONNECTION_TIMEOUT_MS, max: 10 });
    const pool = (Pool as unknown as jest.Mock).mock.results.at(-1)?.value;
    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
