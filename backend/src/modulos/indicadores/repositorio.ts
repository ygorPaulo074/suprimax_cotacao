// RF17 — leitura agregada de `orcamento` e `resposta_orcamento` para o painel do Sistema 3 (UC09;
// docs/11, seção 11.4, "Módulo de Agregação para BI"). Só conta e soma: nenhuma linha sai deste
// módulo. `orcamento` não tem coluna de valor aceito — ela vive em `resposta_orcamento`
// (`valor_total_aceito`, gravada por `resposta.processar` só no ramo que aceita o orçamento;
// docs/13, seção 13.7.17), datada por `data_processamento`.
import { z } from 'zod';
import { decimalParaCentavos, consultar, validarLinha, type ClienteDeProxy } from '../../dados';
import type { StatusDoOrcamento } from '../orcamentos/repositorio';

export const OPERACOES_DE_INDICADORES = {
  CONTAR_POR_STATUS: 'RF17-contar-por-status',
  CONTAR_ENCERRADOS_NO_PERIODO: 'RF17-contar-encerrados-no-periodo',
  SOMAR_FATURAMENTO_NO_PERIODO: 'RF17-somar-faturamento-no-periodo',
} as const;

const TABELA_DE_ORCAMENTOS = 'orcamento';
const TABELA_DE_RESPOSTAS = 'resposta_orcamento';
const COLUNA_DO_VALOR_ACEITO = 'valor_total_aceito';
const COLUNA_DA_DATA_DE_PROCESSAMENTO = 'data_processamento';

const esquemaDaContagem = z.object({ total: z.number().int() });
const esquemaDaSoma = z.object({ total: z.string().nullable() });

/** Leitura agregada de orçamentos, sem trazer linha nenhuma (sempre uma única contagem/soma). */
export class RepositorioDeIndicadores {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Quantos orçamentos estão em algum dos status informados (RF17: "em aberto"). */
  async contarPorStatus(status: readonly StatusDoOrcamento[]): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: { e: [['status', 'em', status]] },
        agregacoes: [{ fn: 'contar', campo: '*', como: 'total' }],
      },
      OPERACOES_DE_INDICADORES.CONTAR_POR_STATUS,
    );
    return validarLinha(esquemaDaContagem, linha, TABELA_DE_ORCAMENTOS).total;
  }

  /**
   * Quantos orçamentos saíram de aberto com este status dentro do período `[inicio, fim)`
   * (RF17: "fechados no dia", "recusados no dia"). `inicio`/`fim` são timestamps ISO.
   */
  async contarEncerradosNoPeriodo(
    status: StatusDoOrcamento,
    inicio: string,
    fim: string,
  ): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: {
          e: [
            ['status', '=', status],
            ['data_encerramento', '>=', inicio],
            ['data_encerramento', '<', fim],
          ],
        },
        agregacoes: [{ fn: 'contar', campo: '*', como: 'total' }],
      },
      OPERACOES_DE_INDICADORES.CONTAR_ENCERRADOS_NO_PERIODO,
    );
    return validarLinha(esquemaDaContagem, linha, TABELA_DE_ORCAMENTOS).total;
  }

  /**
   * Soma, em centavos, do valor aceito das respostas processadas no período `[inicio, fim)`
   * (RF17: faturamento do dia/mês — "os fechados e o faturamento consideram o valor aceito").
   * `valor_total_aceito` só é gravado no ramo de aceite de `resposta.processar`, então o filtro
   * "não nulo" já isola exatamente as respostas que fecharam um orçamento nesta janela.
   */
  async somarFaturamentoNoPeriodo(inicio: string, fim: string): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_RESPOSTAS,
        filtros: {
          e: [
            [COLUNA_DO_VALOR_ACEITO, 'nao_nulo'],
            [COLUNA_DA_DATA_DE_PROCESSAMENTO, '>=', inicio],
            [COLUNA_DA_DATA_DE_PROCESSAMENTO, '<', fim],
          ],
        },
        agregacoes: [{ fn: 'soma', campo: COLUNA_DO_VALOR_ACEITO, como: 'total' }],
      },
      OPERACOES_DE_INDICADORES.SOMAR_FATURAMENTO_NO_PERIODO,
    );
    const { total } = validarLinha(esquemaDaSoma, linha, TABELA_DE_RESPOSTAS);
    return total === null ? 0 : decimalParaCentavos(total);
  }
}
