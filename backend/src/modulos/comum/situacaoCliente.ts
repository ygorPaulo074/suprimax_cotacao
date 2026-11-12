// UC10/UC14 — situação de crédito e de primeira compra do cliente, usada tanto na tela de
// detalhe do pedido quanto na montagem do orçamento (RN06, RN07). Fica em `comum` porque nenhum
// dos dois módulos (pedidos, orçamentos) é dono do conceito.
import { z } from 'zod';
import { consultar, validarLinha, type ClienteDeProxy } from '../../dados';

export const RESULTADOS_DE_CREDITO = ['APROVADO', 'REPROVADO'] as const;
export type ResultadoDeCredito = (typeof RESULTADOS_DE_CREDITO)[number];

/** Situação de crédito e de histórico do cliente. É o tipo `SituacaoCliente` do frontend. */
export interface SituacaoCliente {
  /** `null` enquanto não há análise concluída. */
  readonly creditoAprovado: boolean | null;
  /** Não existe como coluna no dicionário de dados; sempre `null` (sem limite numérico definido). */
  readonly limiteCredito: number | null;
  readonly dividaEmAberto: number;
  readonly primeiraCompra: boolean;
}

const TABELA_DE_ANALISES = 'analise_credito';
const TABELA_DE_ORCAMENTOS = 'orcamento';
const STATUS_DE_COMPRA_CONCLUIDA = 'ACEITO';

const esquemaDaAnalise = z.object({ resultado: z.enum(RESULTADOS_DE_CREDITO).nullable() });

/** Monta a situação de crédito do cliente a partir de `analise_credito` e `orcamento`. */
export async function obterSituacaoCliente(
  proxy: ClienteDeProxy,
  idCliente: number,
  dividaEmAberto: number,
  operationId: string,
): Promise<SituacaoCliente> {
  const [analise] = await consultar(
    proxy,
    {
      tabela: TABELA_DE_ANALISES,
      campos: ['resultado'],
      filtros: { e: [['id_cliente', '=', idCliente]] },
      ordenacao: [['data_solicitacao', 'desc']],
      limite: 1,
    },
    operationId,
  );
  const resultado =
    analise === undefined
      ? null
      : validarLinha(esquemaDaAnalise, analise, TABELA_DE_ANALISES).resultado;
  const creditoAprovado = resultado === null ? null : resultado === 'APROVADO';

  const [orcamentoAceito] = await consultar(
    proxy,
    {
      tabela: TABELA_DE_ORCAMENTOS,
      campos: ['id_orcamento'],
      filtros: {
        e: [
          ['id_cliente', '=', idCliente],
          ['status', '=', STATUS_DE_COMPRA_CONCLUIDA],
        ],
      },
      limite: 1,
    },
    operationId,
  );

  return {
    creditoAprovado,
    limiteCredito: null,
    dividaEmAberto,
    primeiraCompra: orcamentoAceito === undefined,
  };
}
