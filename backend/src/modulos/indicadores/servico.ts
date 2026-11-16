// RF17 — monta o resumo de indicadores consumido pelo painel do Sistema 3 (UC09).
import type { Logger } from '../../log';
import { STATUS_DO_ORCAMENTO_EM_ABERTO } from '../orcamentos/repositorio';
import type { RepositorioDeIndicadores } from './repositorio';

/** Resumo do dia para o painel do Sistema 3 (RF17). Valores de faturamento em centavos. */
export interface IndicadoresBI {
  readonly orcamentosEmAberto: number;
  readonly orcamentosFechadosNoDia: number;
  readonly orcamentosRecusadosNoDia: number;
  readonly faturamentoNoDia: number;
  readonly faturamentoNoMes: number;
}

export interface DependenciasDoServicoDeIndicadores {
  readonly indicadores: RepositorioDeIndicadores;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Monta o `início` (inclusivo) e o `fim` (exclusivo) do dia e do mês corrente, em UTC. */
function periodosDoResumo(agora: Date): {
  diaInicio: string;
  diaFim: string;
  mesInicio: string;
  mesFim: string;
} {
  const ano = agora.getUTCFullYear();
  const mes = agora.getUTCMonth();
  const dia = agora.getUTCDate();
  const isoDoDia = (data: Date): string => new Date(data).toISOString();
  return {
    diaInicio: isoDoDia(new Date(Date.UTC(ano, mes, dia))),
    diaFim: isoDoDia(new Date(Date.UTC(ano, mes, dia + 1))),
    mesInicio: isoDoDia(new Date(Date.UTC(ano, mes, 1))),
    mesFim: isoDoDia(new Date(Date.UTC(ano, mes + 1, 1))),
  };
}

/** Regras de negócio dos indicadores de BI (RF17). */
export class ServicoDeIndicadores {
  private readonly indicadores: RepositorioDeIndicadores;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeIndicadores) {
    this.indicadores = dependencias.indicadores;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /** Monta o resumo (RF17): em aberto, fechados e recusados no dia, faturamento do dia e do mês. */
  async obterResumo(): Promise<IndicadoresBI> {
    const { diaInicio, diaFim, mesInicio, mesFim } = periodosDoResumo(this.agora());
    const [
      orcamentosEmAberto,
      orcamentosFechadosNoDia,
      orcamentosRecusadosNoDia,
      faturamentoNoDia,
      faturamentoNoMes,
    ] = await Promise.all([
      this.indicadores.contarPorStatus([...STATUS_DO_ORCAMENTO_EM_ABERTO]),
      this.indicadores.contarEncerradosNoPeriodo('ACEITO', diaInicio, diaFim),
      this.indicadores.contarEncerradosNoPeriodo('RECUSADO', diaInicio, diaFim),
      this.indicadores.somarFaturamentoNoPeriodo(diaInicio, diaFim),
      this.indicadores.somarFaturamentoNoPeriodo(mesInicio, mesFim),
    ]);
    this.logger.info({ evento: 'indicadores_bi_consultados' }, 'Resumo de indicadores consultado.');
    return {
      orcamentosEmAberto,
      orcamentosFechadosNoDia,
      orcamentosRecusadosNoDia,
      faturamentoNoDia,
      faturamentoNoMes,
    };
  }
}
