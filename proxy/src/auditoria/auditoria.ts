import type { Logger } from 'pino';
import type { Executor } from '../banco/executor';

// Log de auditoria (docs/12, seção 12.7). Cada requisição gera uma entrada, gravada na tabela
// log_auditoria porque o disco do Render é efêmero. Nunca registrar tokens, senhas nem payloads.

export type ResultadoRisco = 'APROVADO' | 'BLOQUEADO' | 'NAO_APLICAVEL';

export interface EntradaAuditoria {
  timestamp: Date;
  sistemaOrigem: string;
  operacao: string;
  resultadoVerificacaoRisco: ResultadoRisco;
  statusExecucao: 'SUCESSO' | 'ERRO';
  duracaoMs: number;
  requestId: string;
  /** 'ok' ou o código do erro (ex.: ESCOPO_NEGADO). */
  resultado: string;
  idUsuario: string | null;
  ipOrigem: string | null;
}

export interface RepositorioAuditoria {
  registrar(entrada: EntradaAuditoria): Promise<void>;
}

export class RepositorioAuditoriaMemoria implements RepositorioAuditoria {
  readonly entradas: EntradaAuditoria[] = [];
  async registrar(entrada: EntradaAuditoria): Promise<void> {
    this.entradas.push(entrada);
  }
}

export class RepositorioAuditoriaPg implements RepositorioAuditoria {
  constructor(private readonly banco: Executor) {}

  async registrar(e: EntradaAuditoria): Promise<void> {
    await this.banco.consultar({
      texto:
        'INSERT INTO log_auditoria ("timestamp", sistema_origem, operacao, resultado_verificacao_risco, status_execucao, duracao_ms, request_id, resultado, id_usuario, ip_origem) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      valores: [
        e.timestamp,
        e.sistemaOrigem,
        e.operacao,
        e.resultadoVerificacaoRisco,
        e.statusExecucao,
        e.duracaoMs,
        e.requestId,
        e.resultado,
        e.idUsuario,
        e.ipOrigem,
      ],
    });
  }
}

export class Auditoria {
  constructor(
    private readonly logger: Logger,
    private readonly repositorio?: RepositorioAuditoria,
  ) {}

  /** Falha ao gravar a auditoria é registrada no log, mas não derruba a requisição. */
  async registrar(entrada: EntradaAuditoria): Promise<void> {
    this.logger.info({ auditoria: entrada }, 'requisicao');
    try {
      await this.repositorio?.registrar(entrada);
    } catch (erro) {
      this.logger.error({ err: erro, requestId: entrada.requestId }, 'falha ao gravar auditoria');
    }
  }
}
