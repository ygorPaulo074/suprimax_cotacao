import { api } from './client';
import type { Divida, DividaNova, Renegociacao } from './types';

export const dividasApi = {
  listar: () => api.get<Divida[]>('/dividas'),
  registrar: (dados: DividaNova) => api.post<Divida>('/dividas', dados),
  /** 422 RENEGOCIACAO_ABAIXO_DO_MINIMO quando valorPago < 50% da dívida (a tela alerta antes de enviar). */
  renegociar: (idDivida: number, dados: Renegociacao) =>
    api.post<Divida>(`/dividas/${idDivida}/renegociar`, dados),
  /** Marca a dívida como quitada (UC23, passo 5); só FINANCEIRO. */
  quitar: (idDivida: number) => api.post<Divida>(`/dividas/${idDivida}/quitar`),
};
