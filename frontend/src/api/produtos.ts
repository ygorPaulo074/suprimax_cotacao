import { api } from './client';
import type {
  AjusteEstoque,
  BuscaProdutoParams,
  MovimentacaoEstoque,
  Produto,
  ProdutoSalvar,
  SaldoEstoque,
} from './types';

export const produtosApi = {
  /** Busca do catálogo (UC15), com preços da tabela do cliente. */
  buscar: (params: BuscaProdutoParams) =>
    api.get<Produto[]>('/produtos/busca', { query: { ...params } }),
  listar: (q?: string) => api.get<Produto[]>('/produtos', { query: { q } }),
  obter: (idProduto: number) => api.get<Produto>(`/produtos/${idProduto}`),
  criar: (dados: ProdutoSalvar) => api.post<Produto>('/produtos', dados),
  /** Faixas de preço e fardos só são aceitos de OPERADOR_CHEFE (403 caso contrário). */
  atualizar: (idProduto: number, dados: ProdutoSalvar) =>
    api.put<Produto>(`/produtos/${idProduto}`, dados),

  // Estoque (UC24)
  buscarVariacoes: (q: string) => api.get<SaldoEstoque[]>('/estoque/variacoes', { query: { q } }),
  saldo: (idVariacao: number) => api.get<SaldoEstoque>(`/estoque/variacoes/${idVariacao}`),
  movimentacoes: (idVariacao: number) =>
    api.get<MovimentacaoEstoque[]>(`/estoque/variacoes/${idVariacao}/movimentacoes`),
  /** 422 AJUSTE_ABAIXO_DO_RESERVADO quando o físico ficaria abaixo do reservado. */
  ajustar: (idVariacao: number, ajuste: AjusteEstoque) =>
    api.post<SaldoEstoque>(`/estoque/variacoes/${idVariacao}/ajustes`, ajuste),
};
