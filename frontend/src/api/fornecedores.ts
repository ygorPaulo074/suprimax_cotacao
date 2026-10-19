import { api } from './client';
import type { EntradaMercadoriaNova, Fornecedor, FornecedorNovo } from './types';

export const fornecedoresApi = {
  listar: () => api.get<Fornecedor[]>('/fornecedores'),
  criar: (dados: FornecedorNovo) => api.post<Fornecedor>('/fornecedores', dados),
  /**
   * Entrada de mercadoria (UC04). 422 ENTRADA_DIVERGENTE quando comprada != informada e não há
   * `liberacao`; 403 LIBERACAO_NEGADA se as credenciais não forem de um OPERADOR_CHEFE.
   */
  registrarEntrada: (dados: EntradaMercadoriaNova) => api.post<void>('/entradas-mercadoria', dados),
};
