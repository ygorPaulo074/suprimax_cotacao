// Fronteira com o Postgres. Tudo o que o proxy executa passa por aqui, sempre como texto
// parametrizado + valores. As implementações: Postgres (pg.ts) e dublês nos testes.

export interface Consulta {
  texto: string;
  valores: unknown[];
}

export interface ResultadoConsulta {
  linhas: Record<string, unknown>[];
  /** Linhas afetadas (INSERT/UPDATE/DELETE) ou devolvidas (SELECT). */
  contagem: number;
}

export interface Executor {
  consultar(consulta: Consulta): Promise<ResultadoConsulta>;
  /** Executa `fn` numa transação; qualquer exceção desfaz tudo. */
  transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T>;
}

/** Erro vindo do banco. A mensagem é interna: nunca chega ao cliente (docs/12, seção 12.6). */
export class ErroBanco extends Error {
  constructor(
    mensagem: string,
    public readonly codigoSql?: string,
  ) {
    super(mensagem);
    this.name = 'ErroBanco';
  }
}
