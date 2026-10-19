import type { CondicaoPagamento } from '@/api/types';

// Opções exibidas nos campos (docs/10, tela 6). Quem decide o que é permitido para cada
// orçamento é o backend/módulo de cálculo (`condicoesPagamentoPermitidas`); aqui só se listam os valores.
export const PRAZOS_BOLETO_DIAS = [10, 15, 20, 28, 30] as const;
export const PARCELAS_DISPONIVEIS = [2, 3, 4, 5, 6] as const;

export const ROTULO_CONDICAO_PAGAMENTO: Record<CondicaoPagamento, string> = {
  ADIANTADO_100: '100% adiantado',
  BOLETO: 'Boleto',
  PARCELADO: 'Parcelado (até 6x)',
  ADIANTADO_50_50: '50% adiantado + 50% após a entrega',
};
