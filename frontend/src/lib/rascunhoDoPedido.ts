// UC10-A3 — decisão ao reabrir um pedido devolvido à lista que já tem orçamento em RASCUNHO.
import type { PedidoDetalhe } from '@/api/types';

/** Verdadeiro quando o operador precisa escolher entre retomar o rascunho anterior ou começar um novo. */
export function precisaDecidirRascunho(
  pedido: Pick<PedidoDetalhe, 'status' | 'idOrcamentoRascunho'>,
): boolean {
  return pedido.status === 'EM_ANALISE' && pedido.idOrcamentoRascunho !== null;
}

/** Rota do rascunho a retomar. */
export function rotaDoRascunho(idOrcamento: number): string {
  return `/orcamentos/${idOrcamento}`;
}
