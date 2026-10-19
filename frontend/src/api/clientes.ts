import { api } from './client';
import type {
  ClienteFicha,
  ClienteNovo,
  HistoricoCompra,
  OrcamentoResumo,
  VendedorOpcao,
} from './types';

export const clientesApi = {
  /** 404 CLIENTE_NAO_ENCONTRADO quando o CNPJ não existe (a tela oferece Cadastrar cliente). */
  buscarPorCnpj: (cnpj: string) => api.get<ClienteFicha>('/clientes/busca', { query: { cnpj } }),
  criar: (dados: ClienteNovo) => api.post<ClienteFicha>('/clientes', dados),
  orcamentosEmAberto: (idCliente: number) =>
    api.get<OrcamentoResumo[]>(`/clientes/${idCliente}/orcamentos-em-aberto`),
  historicoCompras: (idCliente: number) =>
    api.get<HistoricoCompra[]>(`/clientes/${idCliente}/historico-compras`),
  /** Operadores com perfil VENDEDOR, para o campo "vendedor responsável". */
  vendedores: () => api.get<VendedorOpcao[]>('/vendedores'),
};
