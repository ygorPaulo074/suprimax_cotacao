// Item 9 do backend/TAREFAS.md — jobs agendados: expiração de rascunhos e de orçamentos
// pendentes de crédito, apagamento do rascunho expirado, expiração do orçamento emitido e da
// reserva de estoque, e marcação de protesto da dívida em atraso (RF16, RF23, RN06, RN25;
// docs/11, seção 11.4; docs/13, seção 13.4 e "Fora do escopo deste documento"). É o único arquivo
// do módulo que conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  consultarTodas,
  emBlocos,
  MAXIMO_DE_LINHAS_POR_ALTERACAO,
  validarLinha,
} from '../../dados';
import type { ClienteDeProxy } from '../../dados';

export const OPERACOES_DE_JOBS = {
  LISTAR_RASCUNHOS_PARA_EXPIRAR: 'JOB01-listar-rascunhos-para-expirar',
  EXPIRAR_RASCUNHOS: 'JOB01-expirar-rascunhos',
  APAGAR_RASCUNHOS_EXPIRADOS: 'JOB02-apagar-rascunhos-expirados',
  LISTAR_ORCAMENTOS_EMITIDOS_VENCIDOS: 'JOB03-listar-orcamentos-emitidos-vencidos',
  EXPIRAR_ORCAMENTOS_EMITIDOS: 'JOB03-expirar-orcamentos-emitidos',
  REGISTRAR_HISTORICO_DE_EXPIRACAO: 'JOB-registrar-historico-de-expiracao',
  LISTAR_RESERVAS_VENCIDAS: 'JOB04-listar-reservas-vencidas',
  EXPIRAR_RESERVAS: 'JOB04-expirar-reservas',
  LISTAR_DIVIDAS_PARA_PROTESTAR: 'JOB05-listar-dividas-para-protestar',
  PROTESTAR_DIVIDAS: 'JOB05-protestar-dividas',
} as const;

/** Função do banco que expira e apaga rascunhos (migration 20261112002000). */
const FUNCAO_EXPIRAR_RASCUNHOS = 'proxy_job_expirar_rascunhos';
const TABELA_DE_ORCAMENTOS = 'orcamento';
const TABELA_DE_HISTORICO = 'historico_orcamento';
const TABELA_DE_RESERVAS = 'reserva_estoque';
const TABELA_DE_DIVIDAS = 'divida_inadimplencia';

/** Status que ainda não receberam número (RN25) — os únicos que este job expira por inatividade. */
const STATUS_RASCUNHO_OU_PENDENTE = ['RASCUNHO', 'PENDENTE_CREDITO'] as const;
const STATUS_EXPIRADO = 'EXPIRADO';
const STATUS_ABERTO = 'ABERTO';
/** Preenche `orcamento.motivo_expiracao` (docs/13, seção 13.7.9). */
export const MOTIVOS_DE_EXPIRACAO = { RASCUNHO: 'RASCUNHO', VALIDADE: 'VALIDADE' } as const;
const STATUS_RESERVA_VIGENTE = 'CONFIRMADA';
const STATUS_RESERVA_EXPIRADA = 'EXPIRADA';
const STATUS_DIVIDA_EM_ABERTO = 'EM_ABERTO';
const STATUS_DIVIDA_PROTESTADA = 'PROTESTADA';
const TIPO_EVENTO_MUDANCA_STATUS = 'MUDANCA_STATUS';

/** Orçamento candidato à expiração por inatividade, com o status de onde ele parte. */
export interface RascunhoParaExpirar {
  readonly idOrcamento: number;
  readonly status: (typeof STATUS_RASCUNHO_OU_PENDENTE)[number];
}

const esquemaDoRascunhoParaExpirar = z.object({
  idOrcamento: z.number().int(),
  status: z.enum(STATUS_RASCUNHO_OU_PENDENTE),
});
const esquemaDoIdOrcamento = z.object({ idOrcamento: z.number().int() });
const esquemaDoIdReserva = z.object({ idReserva: z.number().int() });
const esquemaDoIdDivida = z.object({ idDivida: z.number().int() });

/**
 * Acesso de dados dos jobs agendados, sempre pelo proxy (RNF05). Cada método corresponde a uma
 * etapa (listar candidatos ou gravar o efeito) de um dos cinco jobs descritos no briefing do
 * item 9 — a orquestração (datas-limite, laço de execução, log) fica em `ServicoDeJobsAgendados`.
 */
export class RepositorioDeJobs {
  constructor(private readonly proxy: ClienteDeProxy) {}

  // ---- Job 1: expirar rascunho/pendente de crédito (RN25; docs/13, "Duração do rascunho") ----

  /** Orçamentos em RASCUNHO/PENDENTE_CREDITO sem edição desde antes de `antesDe` (ISO, UTC). */
  async listarRascunhosParaExpirar(antesDe: string): Promise<RascunhoParaExpirar[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        campos: ['id_orcamento', 'status'],
        filtros: {
          e: [
            ['status', 'em', STATUS_RASCUNHO_OU_PENDENTE],
            ['data_ultima_edicao', '<', antesDe],
          ],
        },
      },
      OPERACOES_DE_JOBS.LISTAR_RASCUNHOS_PARA_EXPIRAR,
    );
    return linhas.map((linha) =>
      validarLinha(esquemaDoRascunhoParaExpirar, linha, TABELA_DE_ORCAMENTOS),
    );
  }

  /** Leva os orçamentos informados a EXPIRADO (motivo RASCUNHO), em blocos de até 50 linhas. */
  async expirarRascunhos(ids: readonly number[], agora: Date): Promise<void> {
    for (const bloco of emBlocos(ids, MAXIMO_DE_LINHAS_POR_ALTERACAO)) {
      await this.proxy.executar(
        'dados.atualizar',
        {
          tabela: TABELA_DE_ORCAMENTOS,
          filtros: {
            e: [
              ['id_orcamento', 'em', bloco],
              ['status', 'em', STATUS_RASCUNHO_OU_PENDENTE],
            ],
          },
          valores: {
            status: STATUS_EXPIRADO,
            motivo_expiracao: MOTIVOS_DE_EXPIRACAO.RASCUNHO,
            data_encerramento: agora.toISOString(),
          },
        },
        OPERACOES_DE_JOBS.EXPIRAR_RASCUNHOS,
      );
    }
  }

  /**
   * Registra, no histórico do orçamento, a mudança de status automática (`id_operador` nulo —
   * docs/13, seção 13.7.15, "nulo em ações automáticas do sistema"). Usado pelos jobs 1 e 3.
   */
  async registrarHistoricoDeExpiracao(
    idOrcamento: number,
    statusAnterior: string,
    observacao: string,
  ): Promise<void> {
    await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA_DE_HISTORICO,
        valores: {
          id_orcamento: idOrcamento,
          id_operador: null,
          tipo_evento: TIPO_EVENTO_MUDANCA_STATUS,
          status_anterior: statusAnterior,
          status_novo: STATUS_EXPIRADO,
          observacao,
        },
      },
      OPERACOES_DE_JOBS.REGISTRAR_HISTORICO_DE_EXPIRACAO,
    );
  }

  // ---- Job 2: apagar o rascunho expirado (RN25; docs/13, "Duração do rascunho") ----

  /**
   * Apaga os rascunhos EXPIRADO há mais de 30 dias chamando a função do banco
   * `proxy_job_expirar_rascunhos` por `dados.rpc` (escopo `rpc:*` do Sistema 2, docs/12, seção
   * 12.8.5).
   *
   * Não dá para apagar por `dados.excluir`: os gatilhos `suprimax_validar_orcamento` e
   * `suprimax_validar_item_orcamento` só deixam apagar orçamento EXPIRADO com a flag de sessão
   * `suprimax.allow_expired_draft_delete`, que só a própria função liga. Ela também faz o
   * `ON DELETE CASCADE` já existente na migration inicial levar itens, anexos, histórico e
   * reservas junto. A função tem o corte de 30 dias embutido e, antes de apagar, expira quem
   * passou do prazo de inatividade; o número devolvido soma expirados e removidos (na rodada
   * normal o job 1 já expirou, então é praticamente só o de removidos).
   *
   * @returns O inteiro que a função devolve.
   */
  async apagarRascunhosExpirados(): Promise<number> {
    const resposta = await this.proxy.executar<{ resultado?: readonly Record<string, unknown>[] }>(
      'dados.rpc',
      { funcao: FUNCAO_EXPIRAR_RASCUNHOS, argumentos: {} },
      OPERACOES_DE_JOBS.APAGAR_RASCUNHOS_EXPIRADOS,
    );
    const linha = resposta.resultado?.[0];
    const valor = linha ? Object.values(linha)[0] : undefined;
    const total = typeof valor === 'string' ? Number(valor) : valor;
    if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
      throw new Error(`Resposta inesperada de ${FUNCAO_EXPIRAR_RASCUNHOS}.`);
    }
    return total;
  }

  // ---- Job 3: expirar o orçamento emitido (RF16; docs/13, "Prazo de atualização de status") ----

  /** Orçamentos ABERTO cuja validade (DATE) já passou, sem aceite. */
  async listarOrcamentosEmitidosVencidos(hoje: string): Promise<number[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        campos: ['id_orcamento'],
        filtros: {
          e: [
            ['status', '=', STATUS_ABERTO],
            ['data_validade', '<', hoje],
          ],
        },
      },
      OPERACOES_DE_JOBS.LISTAR_ORCAMENTOS_EMITIDOS_VENCIDOS,
    );
    return linhas.map(
      (linha) => validarLinha(esquemaDoIdOrcamento, linha, TABELA_DE_ORCAMENTOS).idOrcamento,
    );
  }

  /** Leva os orçamentos informados a EXPIRADO (motivo VALIDADE), em blocos de até 50 linhas. */
  async expirarOrcamentosEmitidos(ids: readonly number[], agora: Date): Promise<void> {
    for (const bloco of emBlocos(ids, MAXIMO_DE_LINHAS_POR_ALTERACAO)) {
      await this.proxy.executar(
        'dados.atualizar',
        {
          tabela: TABELA_DE_ORCAMENTOS,
          filtros: {
            e: [
              ['id_orcamento', 'em', bloco],
              ['status', '=', STATUS_ABERTO],
            ],
          },
          valores: {
            status: STATUS_EXPIRADO,
            motivo_expiracao: MOTIVOS_DE_EXPIRACAO.VALIDADE,
            data_encerramento: agora.toISOString(),
          },
        },
        OPERACOES_DE_JOBS.EXPIRAR_ORCAMENTOS_EMITIDOS,
      );
    }
  }

  // ---- Job 4: expirar a reserva de estoque (docs/13, "Ciclo da reserva de estoque") ----

  /**
   * Reservas CONFIRMADA cuja `data_expiracao` (cópia de `orcamento.data_validade` na emissão) já
   * passou. Não precisa olhar o orçamento: uma reserva baixada no aceite já deixou de ser
   * CONFIRMADA, então o filtro de status já exclui os orçamentos aceitos antes do vencimento.
   */
  async listarReservasVencidas(hoje: string): Promise<number[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_RESERVAS,
        campos: ['id_reserva'],
        filtros: {
          e: [
            ['status', '=', STATUS_RESERVA_VIGENTE],
            ['data_expiracao', '<', hoje],
          ],
        },
      },
      OPERACOES_DE_JOBS.LISTAR_RESERVAS_VENCIDAS,
    );
    return linhas.map(
      (linha) => validarLinha(esquemaDoIdReserva, linha, TABELA_DE_RESERVAS).idReserva,
    );
  }

  /** Leva as reservas informadas a EXPIRADA, em blocos de até 50 linhas. */
  async expirarReservas(ids: readonly number[]): Promise<void> {
    for (const bloco of emBlocos(ids, MAXIMO_DE_LINHAS_POR_ALTERACAO)) {
      await this.proxy.executar(
        'dados.atualizar',
        {
          tabela: TABELA_DE_RESERVAS,
          filtros: {
            e: [
              ['id_reserva', 'em', bloco],
              ['status', '=', STATUS_RESERVA_VIGENTE],
            ],
          },
          valores: { status: STATUS_RESERVA_EXPIRADA },
        },
        OPERACOES_DE_JOBS.EXPIRAR_RESERVAS,
      );
    }
  }

  // ---- Job 5: marcar protesto da dívida (RN06; docs/13, "Protesto por atraso") ----

  /** Dívidas EM_ABERTO (sem renegociação) vencidas há mais de 60 dias corridos. */
  async listarDividasParaProtestar(antesDe: string): Promise<number[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_DIVIDAS,
        campos: ['id_divida'],
        filtros: {
          e: [
            ['status', '=', STATUS_DIVIDA_EM_ABERTO],
            ['data_vencimento_original', '<', antesDe],
          ],
        },
      },
      OPERACOES_DE_JOBS.LISTAR_DIVIDAS_PARA_PROTESTAR,
    );
    return linhas.map(
      (linha) => validarLinha(esquemaDoIdDivida, linha, TABELA_DE_DIVIDAS).idDivida,
    );
  }

  /** Leva as dívidas informadas a PROTESTADA, com a data do protesto, em blocos de até 50. */
  async protestarDividas(ids: readonly number[], hoje: string): Promise<void> {
    for (const bloco of emBlocos(ids, MAXIMO_DE_LINHAS_POR_ALTERACAO)) {
      await this.proxy.executar(
        'dados.atualizar',
        {
          tabela: TABELA_DE_DIVIDAS,
          filtros: {
            e: [
              ['id_divida', 'em', bloco],
              ['status', '=', STATUS_DIVIDA_EM_ABERTO],
            ],
          },
          valores: { status: STATUS_DIVIDA_PROTESTADA, data_protesto: hoje },
        },
        OPERACOES_DE_JOBS.PROTESTAR_DIVIDAS,
      );
    }
  }
}
