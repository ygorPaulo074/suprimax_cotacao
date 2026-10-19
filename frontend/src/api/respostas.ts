import { api } from './client';
import type { FiltroRespostas, RespostaPendenteDetalhe, RespostaPendenteResumo } from './types';

export const respostasApi = {
  listar: (filtro: FiltroRespostas = {}) =>
    api.get<RespostaPendenteResumo[]>('/respostas-pendentes', { query: { ...filtro } }),
  /** Contador exibido ao lado de "Respostas pendentes" no menu. */
  contar: () => api.get<{ total: number }>('/respostas-pendentes/contador'),
  /** Abre o tratamento: cria (ou retoma) o rascunho da nova versão com os itens copiados. */
  obter: (idResposta: number) =>
    api.get<RespostaPendenteDetalhe>(`/respostas-pendentes/${idResposta}`),
  /** Conclui sem nova versão (usado em recusa); a resposta passa a TRATADA. */
  marcarTratada: (idResposta: number) =>
    api.post<void>(`/respostas-pendentes/${idResposta}/tratar-sem-nova-versao`),
  /** Descarta o rascunho da nova versão; a resposta continua pendente. */
  cancelarRascunho: (idResposta: number) =>
    api.delete<void>(`/respostas-pendentes/${idResposta}/rascunho`),
  /**
   * Emite a nova versão (orcamento.emitir): número novo, validade de 30 dias, original SUBSTITUIDO.
   * Editar/remover itens do rascunho usa orcamentosApi sobre `novaVersao.idOrcamento`.
   */
  emitirNovaVersao: (idResposta: number) =>
    api.post<{ idOrcamento: number }>(`/respostas-pendentes/${idResposta}/emitir-nova-versao`),
};
