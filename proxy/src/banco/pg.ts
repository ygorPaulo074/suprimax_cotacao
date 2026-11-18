import { Pool, types, type PoolClient } from 'pg';
import { AppError } from '../erros';
import { ErroBanco, type Consulta, type Executor, type ResultadoConsulta } from './executor';

// Executor sobre o Postgres do Supabase. NÃO foi testado contra um banco real: aguarda o schema
// (ver proxy/README.md). Ao implementar o proxy não havia banco disponível.

/** Erros do driver viram ErroBanco: a mensagem e o SQLSTATE ficam só no log, nunca no cliente. */
function traduzir(e: unknown): ErroBanco {
  const erro = e as { message?: string; code?: string };
  return new ErroBanco(erro.message ?? String(e), erro.code);
}

/** Tempos limite de cada transação (SET LOCAL: morrem no COMMIT/ROLLBACK, valem no pooler). */
export const STATEMENT_TIMEOUT_MS = 8_000;
export const LOCK_TIMEOUT_MS = 5_000;
/** Espera máxima por uma conexão do pool. */
export const CONNECTION_TIMEOUT_MS = 10_000;

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
    let erroDoRollback: Error | undefined;
    try {
      await cliente.query('BEGIN');
      // Sem isto, uma consulta pendurada seguraria a trava e a conexão, e a fila serial pararia.
      await cliente.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await cliente.query(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`);
      const resultado = await fn(new ExecutorCliente(cliente));
      await cliente.query('COMMIT');
      return resultado;
    } catch (e) {
      await cliente.query('ROLLBACK').catch((r: unknown) => {
        erroDoRollback = r instanceof Error ? r : new Error(String(r));
      });
      // Erros de negócio (AppError) e já traduzidos passam intactos; só erros do driver são traduzidos.
      throw e instanceof ErroBanco || e instanceof AppError ? e : traduzir(e);
    } finally {
      // Com erro, o pool descarta a conexão (ROLLBACK que falhou: ela pode estar quebrada).
      cliente.release(erroDoRollback);
    }
  }

  fechar(): Promise<void> {
    return this.pool.end();
  }
}

export function criarExecutorPg(databaseUrl: string): ExecutorPg {
  // BIGINT (ex.: numero_orcamento) volta como número, não como texto.
  types.setTypeParser(types.builtins.INT8, (v) => Number(v));
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });
  // Conexão ociosa derrubada pelo pooler: sem este ouvinte o erro encerraria o processo.
  pool.on('error', () => undefined);
  return new ExecutorPg(pool);
}
