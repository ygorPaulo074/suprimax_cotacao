// UC20, UC21 — leitura e gravação de `resposta_orcamento` e `item_resposta_orcamento`, e a
// operação nomeada `resposta.processar` (docs/12, seção 12.8.3). É o único arquivo do módulo que
// conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  centavosParaDecimal,
  consultar,
  consultarTodas,
  decimalParaCentavos,
  validarLinha,
  type ClienteDeProxy,
  type CondicaoDeFiltro,
  type FiltroDoProxy,
} from '../../dados';
import { ErroProxy } from '../../dados/proxyCliente';
import { CODIGOS_DO_PROXY } from '../../dados/traducaoDeErros';
import { ErroDeRespostaJaProcessada, ErroDeRespostaNaoEncontrada } from '../../erros';

export const TIPOS_DE_RESPOSTA = ['ITENS', 'RECUSA', 'ALTERACAO'] as const;
export type TipoDeResposta = (typeof TIPOS_DE_RESPOSTA)[number];

export const STATUS_DA_RESPOSTA = [
  'PENDENTE',
  'CONSOLIDADA',
  'AGUARDA_OPERADOR',
  'TRATADA',
] as const;
export type StatusDaResposta = (typeof STATUS_DA_RESPOSTA)[number];

export const MOTIVOS_DE_TRATAMENTO = [
  'RECUSA',
  'ALTERACAO',
  'ITENS_NAO_APROVADOS',
  'ABAIXO_DO_MINIMO',
] as const;
export type MotivoDeTratamento = (typeof MOTIVOS_DE_TRATAMENTO)[number];

export const SITUACOES_DO_ITEM = ['APROVADO', 'NAO_APROVADO'] as const;
export type SituacaoDoItem = (typeof SITUACOES_DO_ITEM)[number];

export const OPERACOES_DE_RESPOSTAS = {
  LISTAR: 'UC20-listar-respostas',
  BUSCAR: 'UC21-buscar-resposta',
  LISTAR_ITENS: 'UC20-listar-itens-da-resposta',
  PROCESSAR: 'UC20-processar-resposta',
  MARCAR_TRATADA: 'UC21-marcar-tratada',
} as const;

const TABELA_DE_RESPOSTAS = 'resposta_orcamento';
const TABELA_DE_ITENS = 'item_resposta_orcamento';

const decimalOpcional = z
  .string()
  .nullable()
  .transform((valor) => (valor === null ? null : decimalParaCentavos(valor)));

const esquemaDaResposta = z.object({
  idResposta: z.number().int(),
  idOrcamento: z.number().int(),
  tipoResposta: z.enum(TIPOS_DE_RESPOSTA),
  statusResposta: z.enum(STATUS_DA_RESPOSTA),
  motivoTratamento: z.enum(MOTIVOS_DE_TRATAMENTO).nullable(),
  justificativa: z.string().nullable(),
  idOperadorVendedor: z.number().int(),
  dataResposta: z.string(),
  dataProcessamento: z.string().nullable(),
  idOperadorTratamento: z.number().int().nullable(),
  dataTratamento: z.string().nullable(),
  valorTotalItensAprovado: decimalOpcional,
  valorTotalImpostoAprovado: decimalOpcional,
  modalidadeFreteAceita: z.enum(['CIF', 'FOB']).nullable(),
  valorFreteAceito: decimalOpcional,
  valorTotalAceito: decimalOpcional,
});
export type RespostaDoOrcamento = z.infer<typeof esquemaDaResposta>;

const esquemaDoItem = z.object({
  idItemResposta: z.number().int(),
  idResposta: z.number().int(),
  idItem: z.number().int(),
  quantidadeAprovada: z.number().int(),
  situacao: z.enum(SITUACOES_DO_ITEM),
  idFaixaPrecoAceita: z.number().int().nullable(),
  precoUnitarioAceito: decimalOpcional,
  valorImpostoAceito: decimalOpcional,
  valorTotalItemAceito: decimalOpcional,
});
export type ItemDaResposta = z.infer<typeof esquemaDoItem>;

/** Um item recalculado pelo módulo de cálculo (`recalcularOrcamentoAprovado`), pronto para ir a `resposta.processar`. */
export interface ItemDoResultado {
  readonly idItemResposta: number;
  readonly situacao: SituacaoDoItem;
  readonly idFaixaPrecoAceita: number | null;
  readonly precoUnitarioAceito: number | null;
  readonly valorImpostoAceito: number | null;
  readonly valorTotalItemAceito: number | null;
}

/** Totais consolidados do orçamento aceito, calculados pelo módulo de cálculo (UC20, passo 6-7). */
export interface TotaisDoResultado {
  readonly valorTotalItensAprovado: number;
  readonly valorTotalImpostoAprovado: number;
  readonly modalidadeFreteAceita: 'CIF' | 'FOB' | null;
  readonly valorFreteAceito: number | null;
  readonly valorTotalAceito: number;
}

/** O que `resposta.processar` grava, já calculado pelo backend (docs/12, seção 12.8.3). */
export interface ResultadoDoProcessamento {
  readonly statusResposta: 'CONSOLIDADA' | 'AGUARDA_OPERADOR';
  readonly motivoTratamento: MotivoDeTratamento | null;
  readonly itens: readonly ItemDoResultado[];
  readonly totais: TotaisDoResultado | null;
  readonly statusOrcamento: string;
}

/**
 * Filtro de `GET /respostas-pendentes` (UC21). `tipo` é o `motivo_tratamento` — o que o
 * frontend chama de `TipoRespostaPendente` (docs/frontend-api.md, linha 46) é esse motivo, não
 * o `tipo_resposta` bruto (RECUSA/ALTERACAO/ITENS) que `resposta_orcamento` grava.
 */
export interface FiltroDeRespostasPendentes {
  readonly tipo?: MotivoDeTratamento;
  readonly idVendedor?: number;
}

/** Acesso às respostas do cliente e aos seus itens, sempre pelo proxy. */
export class RepositorioDeRespostas {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Respostas ainda não processadas pelo Sistema 2 (UC20). */
  async listarPendentes(): Promise<RespostaDoOrcamento[]> {
    return this.listar({ e: [['status_resposta', '=', 'PENDENTE']] });
  }

  /** Respostas que exigem tratamento do operador (UC21), com os filtros da tela. */
  async listarAguardandoOperador(
    filtro: FiltroDeRespostasPendentes = {},
  ): Promise<RespostaDoOrcamento[]> {
    const condicoes: CondicaoDeFiltro[] = [['status_resposta', '=', 'AGUARDA_OPERADOR']];
    if (filtro.tipo) {
      condicoes.push(['motivo_tratamento', '=', filtro.tipo]);
    }
    if (filtro.idVendedor !== undefined) {
      condicoes.push(['id_operador_vendedor', '=', filtro.idVendedor]);
    }
    return this.listar({ e: condicoes });
  }

  private async listar(filtros: FiltroDoProxy): Promise<RespostaDoOrcamento[]> {
    const linhas = await consultarTodas(
      this.proxy,
      { tabela: TABELA_DE_RESPOSTAS, filtros, ordenacao: [['id_resposta', 'asc']] },
      OPERACOES_DE_RESPOSTAS.LISTAR,
    );
    return linhas.map((linha) => validarLinha(esquemaDaResposta, linha, TABELA_DE_RESPOSTAS));
  }

  /** Busca a resposta pelo identificador; `null` se não existir. */
  async buscarPorId(idResposta: number): Promise<RespostaDoOrcamento | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_RESPOSTAS,
        filtros: { e: [['id_resposta', '=', idResposta]] },
        limite: 1,
      },
      OPERACOES_DE_RESPOSTAS.BUSCAR,
    );
    return linha === undefined ? null : validarLinha(esquemaDaResposta, linha, TABELA_DE_RESPOSTAS);
  }

  /** Busca a resposta ou lança {@link ErroDeRespostaNaoEncontrada} (404). */
  async buscarOuFalhar(idResposta: number): Promise<RespostaDoOrcamento> {
    const resposta = await this.buscarPorId(idResposta);
    if (!resposta) {
      throw new ErroDeRespostaNaoEncontrada();
    }
    return resposta;
  }

  /** Itens da resposta (um por item do orçamento respondido). */
  async listarItens(idResposta: number): Promise<ItemDaResposta[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ITENS,
        filtros: { e: [['id_resposta', '=', idResposta]] },
        ordenacao: [['id_item_resposta', 'asc']],
      },
      OPERACOES_DE_RESPOSTAS.LISTAR_ITENS,
    );
    return linhas.map((linha) => validarLinha(esquemaDoItem, linha, TABELA_DE_ITENS));
  }

  /**
   * Processa a resposta (`resposta.processar`, UC20): grava os valores calculados nos itens e
   * na própria resposta, muda o orçamento e, no aceite, baixa ou libera as reservas — tudo
   * atomicamente, dentro do proxy.
   *
   * @throws {ErroDeRespostaJaProcessada} Se a resposta não estiver mais PENDENTE (409).
   */
  async processar(idResposta: number, resultado: ResultadoDoProcessamento): Promise<void> {
    try {
      await this.proxy.executar(
        'resposta.processar',
        {
          id_resposta: idResposta,
          resultado: {
            status_resposta: resultado.statusResposta,
            motivo_tratamento: resultado.motivoTratamento,
            itens: resultado.itens.map((item) => ({
              id_item_resposta: item.idItemResposta,
              situacao: item.situacao,
              id_faixa_preco_aceita: item.idFaixaPrecoAceita,
              preco_unitario_aceito:
                item.precoUnitarioAceito === null
                  ? null
                  : centavosParaDecimal(item.precoUnitarioAceito),
              valor_imposto_aceito:
                item.valorImpostoAceito === null
                  ? null
                  : centavosParaDecimal(item.valorImpostoAceito),
              valor_total_item_aceito:
                item.valorTotalItemAceito === null
                  ? null
                  : centavosParaDecimal(item.valorTotalItemAceito),
            })),
            ...(resultado.totais && {
              totais: {
                valor_total_itens_aprovado: centavosParaDecimal(
                  resultado.totais.valorTotalItensAprovado,
                ),
                valor_total_imposto_aprovado: centavosParaDecimal(
                  resultado.totais.valorTotalImpostoAprovado,
                ),
                modalidade_frete_aceita: resultado.totais.modalidadeFreteAceita,
                valor_frete_aceito:
                  resultado.totais.valorFreteAceito === null
                    ? null
                    : centavosParaDecimal(resultado.totais.valorFreteAceito),
                valor_total_aceito: centavosParaDecimal(resultado.totais.valorTotalAceito),
              },
            }),
            status_orcamento: resultado.statusOrcamento,
          },
        },
        OPERACOES_DE_RESPOSTAS.PROCESSAR,
      );
    } catch (erro) {
      if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.RESPOSTA_JA_PROCESSADA) {
        throw new ErroDeRespostaJaProcessada();
      }
      throw erro;
    }
  }

  /** Marca a resposta como tratada pelo operador (UC21, fim do tratamento). */
  async marcarTratada(idResposta: number, idOperador: number, agora: Date): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_RESPOSTAS,
        filtros: { e: [['id_resposta', '=', idResposta]] },
        valores: {
          status_resposta: 'TRATADA',
          id_operador_tratamento: idOperador,
          data_tratamento: agora.toISOString(),
        },
      },
      OPERACOES_DE_RESPOSTAS.MARCAR_TRATADA,
    );
  }
}
