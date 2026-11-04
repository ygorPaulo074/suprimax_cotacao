// Módulo de cálculo de regras comerciais. Funções puras: sem banco, relógio ou rede.
// UC18, UC19 e UC20 — docs/11, seção 11.6.
// Incrementar a cada mudança de regra e registrar em backend/CHANGELOG.md.
export const VERSAO_REGRAS = '1.1.0';

export * from './types';
export * from './erros';
export * from './regras';
export * from './validacao';
export { calcularImpostoItem } from './imposto';
export { validarCondicaoFaturamento } from './faturamento';
export { calcularCondicaoCreditoReprovado } from './creditoReprovado';
export { calcularFrete } from './frete';
export { validarDisponibilidadeEstoque } from './estoque';
export { formatarNumeroOrcamento, calcularValidadeOrcamento } from './orcamento';
export { recalcularOrcamentoAprovado } from './fechamento';
