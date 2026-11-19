import { api } from './client';
import type {
  IndicadoresPedidos,
  PaginaPorCursor,
  ParametrosDePagina,
  PedidoDetalhe,
  PedidoResumo,
  StatusPedido,
} from './types';

export const pedidosApi = {
  /** Fila de pedidos do Sistema 1 e os quatro indicadores da tela 2. */
  listar: (status?: StatusPedido) =>
    api.get<{ itens: PedidoResumo[]; indicadores: IndicadoresPedidos }>('/pedidos', {
      query: { status },
    }),
  /** Uma página da fila (mais recentes primeiro), com os mesmos indicadores. */
  listarPagina: (status?: StatusPedido, pagina: ParametrosDePagina = {}) =>
    api.get<PaginaPorCursor<PedidoResumo> & { indicadores: IndicadoresPedidos }>('/pedidos', {
      query: { status, limite: pagina.limite ?? 50, depois: pagina.depois },
    }),
  obter: (idPedido: number) => api.get<PedidoDetalhe>(`/pedidos/${idPedido}`),
  /** pedido.assumir: SOLICITADO -> EM_ANALISE. 409 PEDIDO_JA_ASSUMIDO se outro operador chegou antes. */
  assumir: (idPedido: number) => api.post<PedidoDetalhe>(`/pedidos/${idPedido}/assumir`),
  /** UC10-A3: EM_ANALISE -> SOLICITADO. 409 PEDIDO_NAO_ASSUMIDO_POR_VOCE se não é seu ou não está em análise. */
  devolver: (idPedido: number) => api.post<void>(`/pedidos/${idPedido}/devolver`),
  /** Cria o orçamento em RASCUNHO a partir do pedido e devolve o seu id. */
  aprovarEMontar: (idPedido: number) =>
    api.post<{ idOrcamento: number }>(`/pedidos/${idPedido}/montar-orcamento`),
  /** Motivo obrigatório; o pedido passa a NEGADO. */
  negar: (idPedido: number, motivo: string) =>
    api.post<void>(`/pedidos/${idPedido}/negar`, { motivo }),
};
