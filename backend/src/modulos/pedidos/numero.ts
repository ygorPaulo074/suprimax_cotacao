const PREFIXO_DO_NUMERO = 'PED-';
const DIGITOS_DO_NUMERO = 4;

/** Número de exibição do pedido, derivado do id (a tabela `pedido` não tem coluna de numeração). */
export function numeroDoPedido(idPedido: number): string {
  return `${PREFIXO_DO_NUMERO}${String(idPedido).padStart(DIGITOS_DO_NUMERO, '0')}`;
}
