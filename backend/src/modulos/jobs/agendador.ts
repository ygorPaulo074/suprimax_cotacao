// Item 9 do backend/TAREFAS.md — disparo periódico, em processo, de `ServicoDeJobsAgendados`.
// Mesmo padrão de `RepositorioDeSessoesEmMemoria.iniciarLimpeza` (setInterval + unref): não
// depende de nenhuma biblioteca nova, e o temporizador não impede o processo de encerrar.
//
// É uma das duas formas de disparo (ver o módulo, `index.ts`): o outro é a rota
// `POST /jobs/executar`, para quem preferir um cron externo (por exemplo, ao nível do próprio
// banco) chamando o backend em vez de depender deste processo ficar sempre de pé — decisão a
// combinar com o responsável pelo banco, como o próprio TAREFAS.md pede para este item.
import type { Logger } from '../../log';
import type { ResumoDoJob, ServicoDeJobsAgendados } from './servico';

/** Intervalo padrão entre execuções, quando `JOBS_AGENDADOS_INTERVALO_MINUTOS` não é informada. */
export const INTERVALO_PADRAO_MINUTOS = 60;
const MILISSEGUNDOS_POR_MINUTO = 60_000;

export interface OpcoesDoAgendadorDeJobs {
  readonly servico: ServicoDeJobsAgendados;
  readonly logger: Logger;
  readonly intervaloMs?: number;
}

/** Liga e desliga a execução periódica dos jobs agendados (item 9). */
export class AgendadorDeJobs {
  private readonly servico: ServicoDeJobsAgendados;
  private readonly logger: Logger;
  private readonly intervaloMs: number;
  private temporizador?: NodeJS.Timeout;

  constructor(opcoes: OpcoesDoAgendadorDeJobs) {
    this.servico = opcoes.servico;
    this.logger = opcoes.logger;
    this.intervaloMs = opcoes.intervaloMs ?? INTERVALO_PADRAO_MINUTOS * MILISSEGUNDOS_POR_MINUTO;
  }

  /** Liga a execução periódica. O temporizador não impede o processo de encerrar. */
  iniciar(): void {
    if (this.temporizador) {
      return;
    }
    this.temporizador = setInterval(() => void this.executar(), this.intervaloMs);
    this.temporizador.unref();
  }

  /** Desliga a execução periódica. */
  parar(): void {
    clearInterval(this.temporizador);
    this.temporizador = undefined;
  }

  /** Dispara uma rodada imediatamente, fora do intervalo — usado pela rota `/jobs/executar`. */
  async executar(): Promise<ResumoDoJob[]> {
    const resumo = await this.servico.executarTodos();
    this.logger.info(
      { evento: 'jobs_agendados_executados', resumo },
      'Rodada dos jobs agendados concluída.',
    );
    return resumo;
  }
}
