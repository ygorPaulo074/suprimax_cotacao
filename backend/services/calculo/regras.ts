// Valores de regra comercial (docs/11, seção 11.6.2.1). Dinheiro em centavos.
// Alterar qualquer valor muda o resultado para a mesma entrada: incrementar VERSAO_REGRAS (MAJOR).
import type { Centavos } from './types';

export const ALIQUOTA_IMPOSTO_PERCENTUAL = 18;
export const FATURAMENTO_MINIMO: Centavos = 50000; // R$ 500,00 (inclusivo)
export const LIMITE_FATURAMENTO_A_PRAZO: Centavos = 50000; // R$ 500,00 (inclusivo)
export const LIMITE_CIF: Centavos = 150000; // R$ 1.500,00 (inclusivo)
export const LIMITE_PARCELAMENTO: Centavos = 150000; // R$ 1.500,00 (inclusivo)
export const PRAZOS_BOLETO_DIAS = [10, 15, 20, 28, 30] as const;
export const VALIDADE_ORCAMENTO_DIAS = 30;
export const PERCENTUAL_ADIANTAMENTO = 50;
export const MAXIMO_PARCELAS = 6;
export const PARCELA_MINIMA: Centavos = 25000; // R$ 250,00
