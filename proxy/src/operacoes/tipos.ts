import type { z } from 'zod';
import { AppError } from '../erros';
import type { ContextoAutenticado } from '../auth/autenticacao';
import type { RepositorioIntegrantes } from '../auth/integrantes';
import type { ResultadoRisco } from '../auditoria/auditoria';
import type { Executor } from '../banco/executor';
import type { Esquema } from '../esquema/esquema';

export interface DepsOperacoes {
  integrantes: RepositorioIntegrantes;
  segredoJwt: string;
  agora: () => Date;
}

export interface ContextoOperacao {
  esquema: Esquema;
  banco: Executor;
  auth: ContextoAutenticado;
  deps: DepsOperacoes;
  /** O integrante pode ler as colunas sensíveis (escopo operador.credenciais:consultar). */
  credenciais: boolean;
  registrarRisco(resultado: ResultadoRisco): void;
}

/** Corpo de sucesso da resposta, sem o `ok` (docs/12, seção 12.8.1). */
export type ResultadoOperacao = Record<string, unknown>;

export interface OperacaoPreparada {
  /** Escopos que o integrante precisa ter; conferidos antes de executar qualquer coisa. */
  escopos: string[];
  /** Domínio registrado na fila de escrita (tabela, rpc ou operação). */
  dominio: string;
  executar(): Promise<ResultadoOperacao>;
}

export interface Operacao {
  id: string;
  /** Operação da administração: exige a chave mestra em vez de token de integrante. */
  admin?: boolean;
  /** Escritas passam pela fila (docs/12, seção 12.5); consultas não. */
  escrita: boolean;
  /** Valida o payload e devolve o que precisa ser autorizado e executado. */
  preparar(payload: unknown, ctx: ContextoOperacao): OperacaoPreparada;
}

/** Valida com zod; qualquer divergência vira PAYLOAD_INVALIDO (os detalhes só vão ao log). */
export function analisar<S extends z.ZodTypeAny>(schema: S, payload: unknown): z.infer<S> {
  const r = schema.safeParse(payload);
  if (!r.success) {
    throw new AppError(
      'PAYLOAD_INVALIDO',
      undefined,
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return r.data;
}
