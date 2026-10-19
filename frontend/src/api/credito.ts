import { api } from './client';
import type {
  AnaliseCreditoDetalhe,
  AnaliseCreditoResumo,
  DataISO,
  ResultadoCredito,
  TipoDocumentoCredito,
} from './types';

export const creditoApi = {
  /** Análises pendentes (e recentes) para o perfil FISCAL. */
  listar: () => api.get<AnaliseCreditoResumo[]>('/analises-credito'),
  obter: (idAnalise: number) => api.get<AnaliseCreditoDetalhe>(`/analises-credito/${idAnalise}`),
  /** Marca o documento do checklist como recebido (status e data de recebimento). */
  registrarDocumento: (idAnalise: number, tipo: TipoDocumentoCredito, dataRecebimento: DataISO) =>
    api.post<AnaliseCreditoDetalhe>(`/analises-credito/${idAnalise}/documentos`, {
      tipoDocumento: tipo,
      dataRecebimento,
    }),
  /** Aprovado ou Reprovado; o orçamento volta de PENDENTE_CREDITO para RASCUNHO. */
  registrarResultado: (idAnalise: number, resultado: ResultadoCredito) =>
    api.post<AnaliseCreditoDetalhe>(`/analises-credito/${idAnalise}/resultado`, { resultado }),
};
