/**
 * Cache de leitura mínimo para o orçamento aberto continuar visível sem conexão (RNF06).
 * Guarda só o último orçamento lido; é apagado no logout. Nunca guarda token.
 */
import type { OrcamentoDetalhe } from './types';

const CHAVE = 'suprimax.orcamento-aberto';

function armazenamento(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function salvarOrcamentoAberto(id: number, dados: OrcamentoDetalhe): void {
  try {
    armazenamento()?.setItem(CHAVE, JSON.stringify({ id, dados }));
  } catch {
    /* sem armazenamento ou cheio: segue sem cache */
  }
}

export function lerOrcamentoAberto(): { id: number; dados: OrcamentoDetalhe } | null {
  try {
    const bruto = armazenamento()?.getItem(CHAVE);
    if (!bruto) return null;
    const lido = JSON.parse(bruto) as { id?: unknown; dados?: unknown };
    return typeof lido.id === 'number' && lido.dados
      ? { id: lido.id, dados: lido.dados as OrcamentoDetalhe }
      : null;
  } catch {
    return null;
  }
}

export function limparCacheLocal(): void {
  try {
    armazenamento()?.removeItem(CHAVE);
  } catch {
    /* ignora */
  }
}
