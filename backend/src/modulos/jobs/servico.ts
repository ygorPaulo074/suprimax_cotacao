// Item 9 do backend/TAREFAS.md — orquestração dos cinco jobs agendados: calcula as datas-limite,
// chama o repositório e registra o resultado no log. Nenhum destes jobs tem usuário na ponta
// (RF16, RN06; docs/11, seção 11.4), então o relógio e o log substituem o que, nas demais rotas,
// vem da sessão.
import type { Logger } from '../../log';
import type { RepositorioDeJobs } from './repositorio';

/** Dias sem edição até o rascunho/pendente de crédito expirar (RN25). */
export const DIAS_PARA_EXPIRAR_RASCUNHO = 30;
/** Dias depois da expiração até o rascunho ser apagado (RN25). */
export const DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO = 30;
/** Dias de atraso até a dívida ser protestada (RN06). */
export const DIAS_DE_ATRASO_PARA_PROTESTO = 60;

const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const OBSERVACAO_EXPIRACAO_POR_INATIVIDADE =
  'Expiração automática (job agendado): 30 dias sem edição, sem chegar a ser emitido.';
const OBSERVACAO_EXPIRACAO_POR_VALIDADE =
  'Expiração automática (job agendado): 30 dias após a emissão, sem aceite do cliente.';

/** `data` menos `dias` dias corridos. */
function subtrairDias(data: Date, dias: number): Date {
  return new Date(data.getTime() - dias * MILISSEGUNDOS_POR_DIA);
}

/** Só a parte de data (YYYY-MM-DD), para comparar com colunas DATE (`data_validade` etc.). */
function comoData(data: Date): string {
  return data.toISOString().slice(0, 10);
}

export interface DependenciasDoServicoDeJobs {
  readonly jobs: RepositorioDeJobs;
  readonly logger: Logger;
  /** Relógio; por padrão, a hora do sistema. Os testes passam um relógio controlado. */
  readonly agora?: () => Date;
  /**
   * Processa as respostas PENDENTE do cliente (UC20) e devolve quantas foram processadas. Entra
   * como sexto passo de `executarTodos`; vem do módulo de respostas (`ServicoDeRespostas`), que
   * isola a falha de cada resposta.
   */
  readonly processarRespostasPendentes?: () => Promise<number>;
}

/** Resultado de um job dentro de `executarTodos`. */
export interface ResumoDoJob {
  readonly job: string;
  readonly processados: number;
  /** Presente só quando o job falhou; os demais jobs continuam mesmo assim. */
  readonly erro?: string;
}

/**
 * Jobs agendados do item 9: cada método público é um dos cinco jobs do briefing (expirar
 * rascunho/pendente de crédito, apagar rascunho expirado, expirar orçamento emitido, expirar
 * reserva de estoque, marcar protesto de dívida). Quem dispara a execução periódica é
 * `AgendadorDeJobs`; a rota `POST /jobs/executar` é o disparo manual/externo.
 */
export class ServicoDeJobsAgendados {
  private readonly jobs: RepositorioDeJobs;
  private readonly logger: Logger;
  private readonly agora: () => Date;
  private readonly processarRespostasPendentes?: () => Promise<number>;

  constructor(dependencias: DependenciasDoServicoDeJobs) {
    this.jobs = dependencias.jobs;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
    this.processarRespostasPendentes = dependencias.processarRespostasPendentes;
  }

  /** Job 1 — RASCUNHO/PENDENTE_CREDITO sem edição há 30 dias → EXPIRADO (RN25). */
  async expirarRascunhosEPendentesDeCredito(): Promise<number> {
    const agora = this.agora();
    const limite = subtrairDias(agora, DIAS_PARA_EXPIRAR_RASCUNHO).toISOString();
    const candidatos = await this.jobs.listarRascunhosParaExpirar(limite);
    if (candidatos.length === 0) {
      return 0;
    }
    await this.jobs.expirarRascunhos(
      candidatos.map((candidato) => candidato.idOrcamento),
      agora,
    );
    for (const candidato of candidatos) {
      await this.jobs.registrarHistoricoDeExpiracao(
        candidato.idOrcamento,
        candidato.status,
        OBSERVACAO_EXPIRACAO_POR_INATIVIDADE,
      );
    }
    this.logger.info(
      { evento: 'job_expirar_rascunhos', processados: candidatos.length },
      'Rascunhos e pendentes de crédito expirados por inatividade.',
    );
    return candidatos.length;
  }

  /**
   * Job 2 — rascunho EXPIRADO há 30 dias → apagado (RN25), pela função `proxy_job_expirar_rascunhos`
   * do banco (`dados.rpc`). O banco apaga item, anexo, histórico e reservas em cascata (o
   * `ON DELETE CASCADE` já existe na migration inicial); o que impedia o `DELETE` direto eram os
   * gatilhos de exclusão, que exigem a flag ligada dentro da função. O corte de 30 dias é o da
   * função (`DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO` documenta o mesmo valor).
   */
  async apagarRascunhosExpirados(): Promise<number> {
    const apagados = await this.jobs.apagarRascunhosExpirados();
    this.logger.info(
      { evento: 'job_apagar_rascunhos_expirados', processados: apagados },
      'Rascunhos expirados apagados.',
    );
    return apagados;
  }

  /** Job 3 — ABERTO com validade vencida, sem aceite → EXPIRADO (RF16). */
  async expirarOrcamentosEmitidos(): Promise<number> {
    const agora = this.agora();
    const hoje = comoData(agora);
    const candidatos = await this.jobs.listarOrcamentosEmitidosVencidos(hoje);
    if (candidatos.length === 0) {
      return 0;
    }
    await this.jobs.expirarOrcamentosEmitidos(candidatos, agora);
    for (const idOrcamento of candidatos) {
      await this.jobs.registrarHistoricoDeExpiracao(
        idOrcamento,
        'ABERTO',
        OBSERVACAO_EXPIRACAO_POR_VALIDADE,
      );
    }
    this.logger.info(
      { evento: 'job_expirar_orcamentos_emitidos', processados: candidatos.length },
      'Orçamentos emitidos expirados por vencimento da validade.',
    );
    return candidatos.length;
  }

  /** Job 4 — reserva CONFIRMADA com validade vencida → EXPIRADA (docs/13, "Ciclo da reserva"). */
  async expirarReservas(): Promise<number> {
    const hoje = comoData(this.agora());
    const candidatos = await this.jobs.listarReservasVencidas(hoje);
    if (candidatos.length === 0) {
      return 0;
    }
    await this.jobs.expirarReservas(candidatos);
    this.logger.info(
      { evento: 'job_expirar_reservas', processados: candidatos.length },
      'Reservas de estoque expiradas por vencimento da validade.',
    );
    return candidatos.length;
  }

  /** Job 5 — dívida EM_ABERTO vencida há mais de 60 dias → PROTESTADA (RN06). */
  async marcarProtestoDeDividas(): Promise<number> {
    const agora = this.agora();
    const limite = comoData(subtrairDias(agora, DIAS_DE_ATRASO_PARA_PROTESTO));
    const candidatos = await this.jobs.listarDividasParaProtestar(limite);
    if (candidatos.length === 0) {
      return 0;
    }
    await this.jobs.protestarDividas(candidatos, comoData(agora));
    this.logger.info(
      { evento: 'job_marcar_protesto_de_dividas', processados: candidatos.length },
      'Dívidas em atraso marcadas como protestadas.',
    );
    return candidatos.length;
  }

  /**
   * Executa os cinco jobs (e o processamento das respostas pendentes, UC20, quando ligado) em sequência. Um job que falhar é registrado no log e no resumo, sem
   * impedir os demais — as falhas ficam isoladas por job.
   */
  async executarTodos(): Promise<ResumoDoJob[]> {
    const jobs: [string, () => Promise<number>][] = [
      [
        'expirar_rascunhos_e_pendentes_de_credito',
        () => this.expirarRascunhosEPendentesDeCredito(),
      ],
      ['apagar_rascunhos_expirados', () => this.apagarRascunhosExpirados()],
      ['expirar_orcamentos_emitidos', () => this.expirarOrcamentosEmitidos()],
      ['expirar_reservas', () => this.expirarReservas()],
      ['marcar_protesto_de_dividas', () => this.marcarProtestoDeDividas()],
    ];
    // UC20: a resposta do cliente gravada pelo Sistema 1 só vira ACEITO/RECUSADO/aguardando
    // operador quando alguém a processa; este passo é o disparo automático.
    if (this.processarRespostasPendentes) {
      jobs.push(['processar_respostas_pendentes', this.processarRespostasPendentes]);
    }
    const resumo: ResumoDoJob[] = [];
    for (const [job, executar] of jobs) {
      try {
        resumo.push({ job, processados: await executar() });
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
        this.logger.error({ evento: 'job_falhou', job, err: erro }, `Job "${job}" falhou.`);
        resumo.push({ job, processados: 0, erro: mensagem });
      }
    }
    return resumo;
  }
}
