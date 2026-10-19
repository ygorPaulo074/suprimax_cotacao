import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErroRequisicao, SkeletonTabela } from './ui';

/**
 * Padroniza os estados de dados (docs/10, seção 10.7): skeleton ao carregar, erro com
 * "Tentar novamente" e, quando `vazio` é informado, tela vazia com a próxima ação.
 */
export function DataState<T>({
  consulta,
  vazio,
  carregando,
  children,
}: {
  consulta: UseQueryResult<T>;
  /** Devolve a tela vazia quando os dados existem mas não há o que mostrar. */
  vazio?: (dados: T) => ReactNode | null;
  carregando?: ReactNode;
  children: (dados: T) => ReactNode;
}) {
  if (consulta.isPending) return <>{carregando ?? <SkeletonTabela />}</>;
  if (consulta.isError) {
    return (
      <ErroRequisicao erro={consulta.error} aoTentarNovamente={() => void consulta.refetch()} />
    );
  }
  const semDados = vazio?.(consulta.data);
  if (semDados) return <>{semDados}</>;
  return <>{children(consulta.data)}</>;
}
