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

  constructor(dependencias: DependenciasDoServicoDeJobs) {
    this.jobs = dependencias.jobs;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
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
   * Job 2 — rascunho EXPIRADO há 30 dias → apagado (RN25).
   *
   * Depende de o esquema do banco apagar em cascata (ou liberar) o histórico do orçamento: o
   * escopo de exclusão do Sistema 2 no proxy não inclui `historico_orcamento`, e todo orçamento
   * tem pelo menos um registro de histórico desde a criação (UC14). Sem isso, a exclusão do
   * orçamento falha por violação de chave estrangeira — ponto a confirmar com o responsável pelo
   * banco antes deste job ir para produção (ver o apontamento na entrega do item 9).
   */
  async apagarRascunhosExpirados(): Promise<number> {
    const limite = subtrairDias(this.agora(), DIAS_PARA_APAGAR_RASCUNHO_EXPIRADO).toISOString();
    const candidatos = await this.jobs.listarRascunhosExpiradosParaApagar(limite);
    let apagados = 0;
    for (const idOrcamento of candidatos) {
      if (await this.jobs.apagarRascunho(idOrcamento)) {
        apagados += 1;
      }
    }
    this.logger.info(
      { evento: 'job_apagar_rascunhos_expirados', candidatos: candidatos.length, apagados },
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
   * Executa os cinco jobs em sequência. Um job que falhar é registrado no log e no resumo, sem
   * impedir os demais — a falha mais previsível hoje é a do job 2 (ver o aviso no seu método).
   */
  async executarTodos(): Promise<ResumoDoJob[]> {
    const jobs: readonly [string, () => Promise<number>][] = [
      [
        'expirar_rascunhos_e_pendentes_de_credito',
        () => this.expirarRascunhosEPendentesDeCredito(),
      ],
      ['apagar_rascunhos_expirados', () => this.apagarRascunhosExpirados()],
      ['expirar_orcamentos_emitidos', () => this.expirarOrcamentosEmitidos()],
      ['expirar_reservas', () => this.expirarReservas()],
      ['marcar_protesto_de_dividas', () => this.marcarProtestoDeDividas()],
    ];
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
