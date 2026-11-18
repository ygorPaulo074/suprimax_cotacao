import { api } from './client';
import type {
  ClienteFicha,
  ClienteNovo,
  EnderecoCliente,
  HistoricoCompra,
  ListaClientesParams,
  PaginaDeClientes,
  OrcamentoResumo,
  VendedorOpcao,
} from './types';

export const clientesApi = {
  /** 404 CLIENTE_NAO_ENCONTRADO quando o CNPJ não existe (a tela oferece Cadastrar cliente). */
  buscarPorCnpj: (cnpj: string) => api.get<ClienteFicha>('/clientes/busca', { query: { cnpj } }),
  /** Página de clientes ordenada por razão social; q/status filtram (UC03). */
  listar: (params: ListaClientesParams = {}) =>
    api.get<PaginaDeClientes>('/clientes', { query: { ...params } }),
  /** UC02-A1: acrescenta um endereço (de entrega) a um cliente existente; devolve a ficha. 404 sem cliente. */
  adicionarEndereco: (idCliente: number, endereco: Omit<EnderecoCliente, 'idEndereco'>) =>
    api.post<ClienteFicha>(`/clientes/${idCliente}/enderecos`, endereco),
  criar: (dados: ClienteNovo) => api.post<ClienteFicha>('/clientes', dados),
  orcamentosEmAberto: (idCliente: number) =>
    api.get<OrcamentoResumo[]>(`/clientes/${idCliente}/orcamentos-em-aberto`),
  historicoCompras: (idCliente: number) =>
    api.get<HistoricoCompra[]>(`/clientes/${idCliente}/historico-compras`),
  /** Operadores com perfil VENDEDOR, para o campo "vendedor responsável". */
  vendedores: () => api.get<VendedorOpcao[]>('/vendedores'),
};
