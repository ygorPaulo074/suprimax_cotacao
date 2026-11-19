import { api } from './client';
import type {
  CondicoesAtualizar,
  FiltroOrcamentos,
  ItemAdicionar,
  OrcamentoCabecalhoAtualizar,
  OrcamentoDetalhe,
  OrcamentoNovo,
  OrcamentoResumo,
  PaginaPorCursor,
  ParametrosDePagina,
  TipoAnexo,
} from './types';

/**
 * Toda mutação devolve o OrcamentoDetalhe já recalculado pelo módulo de cálculo (docs/11, 11.6):
 * a tela nunca calcula imposto, frete ou totais.
 */
export const orcamentosApi = {
  listar: (filtro: FiltroOrcamentos = {}) =>
    api.get<OrcamentoResumo[]>('/orcamentos', { query: { ...filtro } }),
  /** Uma página (mais recentes primeiro); `proximo` da resposta vai em `depois` na seguinte. */
  listarPagina: (filtro: FiltroOrcamentos = {}, pagina: ParametrosDePagina = {}) =>
    api.get<PaginaPorCursor<OrcamentoResumo>>('/orcamentos', {
      // Sem limite nem depois o backend devolveria o formato antigo; a página sempre manda limite.
      query: { ...filtro, limite: pagina.limite ?? 50, depois: pagina.depois },
    }),
  obter: (id: number) => api.get<OrcamentoDetalhe>(`/orcamentos/${id}`),

  /** UC14: cria o rascunho (201) já com o `idOrcamento`; só OPERADOR e OPERADOR_CHEFE (ADMIN também, no backend). */
  criar: (dados: OrcamentoNovo) => api.post<OrcamentoDetalhe>('/orcamentos', dados),

  // Rascunho (UC05, UC14–UC19)
  atualizarCabecalho: (id: number, dados: OrcamentoCabecalhoAtualizar) =>
    api.patch<OrcamentoDetalhe>(`/orcamentos/${id}`, dados),
  /** 422 ESTOQUE_INDISPONIVEL (variação sem saldo) | 503 ESTOQUE_TIMEOUT (a tela oferece Tentar novamente). */
  adicionarItem: (id: number, item: ItemAdicionar) =>
    api.post<OrcamentoDetalhe>(`/orcamentos/${id}/itens`, item),
  alterarQuantidade: (id: number, idItem: number, quantidade: number) =>
    api.patch<OrcamentoDetalhe>(`/orcamentos/${id}/itens/${idItem}`, { quantidade }),
  removerItem: (id: number, idItem: number) =>
    api.delete<OrcamentoDetalhe>(`/orcamentos/${id}/itens/${idItem}`),
  /** Escolhas do operador (pagamento, transportadora, valor do frete); o backend recalcula as condições. */
  atualizarCondicoes: (id: number, dados: CondicoesAtualizar) =>
    api.put<OrcamentoDetalhe>(`/orcamentos/${id}/condicoes`, dados),
  anexar: (id: number, tipo: TipoAnexo, arquivo: File) => {
    const form = new FormData();
    form.append('tipoAnexo', tipo);
    form.append('arquivo', arquivo);
    return api.upload<OrcamentoDetalhe>(`/orcamentos/${id}/anexos`, form);
  },
  /** URL assinada (300 s) para abrir o anexo; 404 ANEXO_NAO_ENCONTRADO. */
  urlDoAnexo: (id: number, idAnexo: number) =>
    api.get<{ url: string; expiraEm: string }>(`/orcamentos/${id}/anexos/${idAnexo}`),
  removerAnexo: (id: number, idAnexo: number) =>
    api.delete<OrcamentoDetalhe>(`/orcamentos/${id}/anexos/${idAnexo}`),

  /** orcamento.emitir: número, validade de 30 dias, chave de segurança e reservas. 422 com BloqueioEmissao. */
  emitir: (id: number) => api.post<OrcamentoDetalhe>(`/orcamentos/${id}/emitir`),
  /** Justificativa opcional. */
  cancelar: (id: number, justificativa?: string) =>
    api.post<void>(`/orcamentos/${id}/cancelar`, { justificativa }),
  baixarPdf: (id: number) => api.baixar(`/orcamentos/${id}/pdf`),
  /** Disponibiliza o orçamento ao vendedor (UC08). */
  enviar: (id: number) => api.post<void>(`/orcamentos/${id}/enviar`),
};
