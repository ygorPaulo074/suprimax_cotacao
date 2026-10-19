import { api } from './client';
import type {
  CondicoesAtualizar,
  FiltroOrcamentos,
  ItemAdicionar,
  OrcamentoCabecalhoAtualizar,
  OrcamentoDetalhe,
  OrcamentoResumo,
  TipoAnexo,
} from './types';

/**
 * Toda mutação devolve o OrcamentoDetalhe já recalculado pelo módulo de cálculo (docs/11, 11.6):
 * a tela nunca calcula imposto, frete ou totais.
 */
export const orcamentosApi = {
  listar: (filtro: FiltroOrcamentos = {}) =>
    api.get<OrcamentoResumo[]>('/orcamentos', { query: { ...filtro } }),
  obter: (id: number) => api.get<OrcamentoDetalhe>(`/orcamentos/${id}`),

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
