// Módulo de cálculo de regras comerciais. Funções puras: sem banco, relógio ou rede.
// Incrementar a cada mudança de regra e registrar em backend/CHANGELOG.md (docs/11, seção 11.6.2.2).
export const VERSAO_REGRAS = '1.0.0';

export * from './types';
export * from './erros';
export * from './regras';
export { calcularImpostoItem } from './imposto';
