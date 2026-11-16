// UC10 — leitura de `pedido`/`item_pedido` e a operação nomeada `pedido.assumir` (docs/12, seção
// 12.8.3). É o único arquivo do módulo que conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  consultar,
  consultarTodas,
  validarLinha,
  type ClienteDeProxy,
  type FiltroDoProxy,
} from '../../dados';
import { ErroDePedidoJaAssumido } from '../../erros';
import { ErroProxy } from '../../dados/proxyCliente';
import { CODIGOS_DO_PROXY } from '../../dados/traducaoDeErros';

export const STATUS_DO_PEDIDO = [
  'SOLICITADO',
  'EM_ANALISE',
  'APROVADO',
  'NEGADO',
  'CANCELADO',
] as const;
export type StatusDoPedido = (typeof STATUS_DO_PEDIDO)[number];

export const GRANULARIDADES = ['FARDO', 'AVULSO'] as const;
export type Granularidade = (typeof GRANULARIDADES)[number];

export const OPERACOES_DE_PEDIDOS = {
  LISTAR: 'UC10-listar-pedidos',
  CONTAR: 'UC10-contar-indicadores',
  BUSCAR: 'UC10-buscar-pedido',
  ASSUMIR: 'UC10-assumir-pedido',
  NEGAR: 'UC10-negar-pedido',
} as const;

const TABELA_DE_PEDIDOS = 'pedido';
const TABELA_DE_ITENS = 'item_pedido';
const OPERACAO_ASSUMIR = 'pedido.assumir';

const esquemaDoPedido = z.object({
  idPedido: z.number().int(),
  idCliente: z.number().int(),
  idOperadorVendedor: z.number().int(),
  idEnderecoEntrega: z.number().int().nullable(),
  numeroSolicitacaoCompra: z.string().nullable(),
  contatoSolicitacao: z.string().nullable(),
  condicaoPagamentoDesejada: z.string().nullable(),
  prazoDiasDesejado: z.number().int().nullable(),
  numeroParcelasDesejado: z.number().int().nullable(),
  transportadoraIndicada: z.string().nullable(),
  observacoes: z.string().nullable(),
  status: z.enum(STATUS_DO_PEDIDO),
  motivoNegativa: z.string().nullable(),
  idOperadorAtendimento: z.number().int().nullable(),
  dataSolicitacao: z.string(),
  dataDecisao: z.string().nullable(),
});

const esquemaDoItemDePedido = z.object({
  idItemPedido: z.number().int(),
  idPedido: z.number().int(),
  idVariacao: z.number().int(),
  granularidade: z.enum(GRANULARIDADES),
  idFardo: z.number().int().nullable(),
  quantidadeSolicitada: z.number().int(),
});

export type Pedido = z.infer<typeof esquemaDoPedido>;
export type ItemDePedido = z.infer<typeof esquemaDoItemDePedido>;

/** Acesso aos pedidos registrados pelo Sistema 1, sempre pelo proxy. */
export class RepositorioDePedidos {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Lista os pedidos, do mais recente para o mais antigo; `status` filtra, quando informado. */
  async listar(status?: StatusDoPedido): Promise<Pedido[]> {
    const filtros: FiltroDoProxy | undefined =
      status === undefined ? undefined : { e: [['status', '=', status]] };
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_PEDIDOS,
        ...(filtros && { filtros }),
        ordenacao: [['data_solicitacao', 'desc']],
      },
      OPERACOES_DE_PEDIDOS.LISTAR,
    );
    return linhas.map((linha) => validarLinha(esquemaDoPedido, linha, TABELA_DE_PEDIDOS));
  }

  /** Conta os pedidos em cada status, para os indicadores da fila (tela 2). */
  async contarPorStatus(status: StatusDoPedido): Promise<number> {
    return this.contar(TABELA_DE_PEDIDOS, { e: [['status', '=', status]] });
  }

  /** Busca o pedido pelo identificador; `null` se não existir. */
  async buscarPorId(idPedido: number): Promise<Pedido | null> {
    const [linha] = await consultar(
      this.proxy,
      { tabela: TABELA_DE_PEDIDOS, filtros: { e: [['id_pedido', '=', idPedido]] }, limite: 1 },
      OPERACOES_DE_PEDIDOS.BUSCAR,
    );
    return linha === undefined ? null : validarLinha(esquemaDoPedido, linha, TABELA_DE_PEDIDOS);
  }

  /** Itens do pedido, na ordem de inclusão. */
  async listarItens(idPedido: number): Promise<ItemDePedido[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ITENS,
        filtros: { e: [['id_pedido', '=', idPedido]] },
        ordenacao: [['id_item_pedido', 'asc']],
      },
      OPERACOES_DE_PEDIDOS.BUSCAR,
    );
    return linhas.map((linha) => validarLinha(esquemaDoItemDePedido, linha, TABELA_DE_ITENS));
  }

  /**
   * Assume o pedido para análise (SOLICITADO → EM_ANALISE), de forma atômica.
   *
   * @throws {ErroDePedidoJaAssumido} Se o pedido não estiver mais SOLICITADO (409).
   */
  async assumir(idPedido: number, idOperador: number): Promise<Pedido> {
    try {
      const resposta = await this.proxy.executar<{ dados: unknown }>(
        OPERACAO_ASSUMIR,
        { id_pedido: idPedido, id_operador: idOperador },
        OPERACOES_DE_PEDIDOS.ASSUMIR,
      );
      return validarLinha(esquemaDoPedido, resposta.dados, TABELA_DE_PEDIDOS);
    } catch (erro) {
      if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.PEDIDO_JA_ASSUMIDO) {
        throw new ErroDePedidoJaAssumido();
      }
      throw erro;
    }
  }

  /** Nega o pedido com o motivo informado; `dataDecisao` recebe o momento da negativa. */
  async negar(idPedido: number, motivo: string, agora: Date): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_PEDIDOS,
        filtros: { e: [['id_pedido', '=', idPedido]] },
        valores: {
          status: 'NEGADO',
          motivo_negativa: motivo,
          data_decisao: agora.toISOString(),
        },
      },
      OPERACOES_DE_PEDIDOS.NEGAR,
    );
  }

  private async contar(tabela: string, filtros: FiltroDoProxy): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      { tabela, filtros, agregacoes: [{ fn: 'contar', campo: '*', como: 'total' }] },
      OPERACOES_DE_PEDIDOS.CONTAR,
    );
    const { total } = validarLinha(z.object({ total: z.number().int() }), linha, tabela);
    return total;
  }
}
