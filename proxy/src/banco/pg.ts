import { Pool, types, type PoolClient } from 'pg';
import { ErroBanco, type Consulta, type Executor, type ResultadoConsulta } from './executor';

// Executor sobre o Postgres do Supabase. NÃO foi testado contra um banco real: aguarda o schema
// (ver proxy/README.md). Ao implementar o proxy não havia banco disponível.

/** Erros do driver viram ErroBanco: a mensagem e o SQLSTATE ficam só no log, nunca no cliente. */
function traduzir(e: unknown): ErroBanco {
  const erro = e as { message?: string; code?: string };
  return new ErroBanco(erro.message ?? String(e), erro.code);
}

class ExecutorCliente implements Executor {
  constructor(private readonly alvo: Pick<Pool | PoolClient, 'query'>) {}

  async consultar({ texto, valores }: Consulta): Promise<ResultadoConsulta> {
    try {
      const r = await this.alvo.query(texto, valores);
      return { linhas: r.rows as Record<string, unknown>[], contagem: r.rowCount ?? r.rows.length };
    } catch (e) {
      throw traduzir(e);
    }
  }

  /** Dentro de uma transação, "transacao" aninhada continua na mesma transação. */
  transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export class ExecutorPg extends ExecutorCliente {
  constructor(private readonly pool: Pool) {
    super(pool);
  }

  override async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(new ExecutorCliente(cliente));
      await cliente.query('COMMIT');
      return resultado;
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw e instanceof ErroBanco ? e : traduzir(e);
    } finally {
      cliente.release();
    }
  }

  fechar(): Promise<void> {
    return this.pool.end();
  }
}

export function criarExecutorPg(databaseUrl: string): ExecutorPg {
  // BIGINT (ex.: numero_orcamento) volta como número, não como texto.
  types.setTypeParser(types.builtins.INT8, (v) => Number(v));
  return new ExecutorPg(new Pool({ connectionString: databaseUrl, max: 10 }));
}
