import type { OrcamentoDetalhe } from '@/api';
import { formatarDataHora } from './datas';

/**
 * Texto da faixa de aviso da montagem do orçamento (UC14 a UC17): qualquer operador pode editar o
 * rascunho de outro, mas o responsável é avisado de que alguém mexeu e quem mexe é avisado de que
 * o rascunho é de outra pessoa. `null` quando não há o que avisar.
 */
export function avisoDeEdicaoDeRascunho(
  orcamento: Pick<OrcamentoDetalhe, 'status' | 'responsavel' | 'ultimaAlteracaoDeOutro'>,
  idDoUsuario: number | null | undefined,
): string | null {
  if (orcamento.status !== 'RASCUNHO' || !orcamento.responsavel || idDoUsuario == null) {
    return null;
  }
  const { responsavel, ultimaAlteracaoDeOutro: alteracao } = orcamento;
  if (responsavel.idOperador !== idDoUsuario) {
    return `Rascunho de ${responsavel.nome}. Suas alterações serão informadas a ele.`;
  }
  if (alteracao && alteracao.idOperador !== idDoUsuario) {
    return `Este rascunho foi alterado por ${alteracao.nome} em ${formatarDataHora(alteracao.data)}.`;
  }
  return null;
}
