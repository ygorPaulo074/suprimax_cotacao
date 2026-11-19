import { useSyncExternalStore } from 'react';
import { assinarFila, itensPendentes, versaoDaFila } from '@/api/filaOffline';

/**
 * RNF06: há alteração desta rota guardada na fila offline persistida (`suprimax.fila`) e ainda
 * não enviada? Nesse caso o dado não se perde ao sair da tela (a fila reenvia sozinha), então a
 * tela não precisa avisar.
 *
 * Exceção deliberada: se algum item da fila esgotou as tentativas (`falhou`), a fila inteira para
 * até o usuário agir e o aviso de falha fica no indicador de pendências, fora da tela; manter o aviso de
 * "não salvo" é o lado seguro. Também não conta se a fila esvaziou (enviado, ou descartado por 4xx):
 * a tela volta a comparar com o último orçamento lido.
 */
export function useAlteracaoNaFila(metodo: string, caminho: string): boolean {
  useSyncExternalStore(assinarFila, versaoDaFila);
  const fila = itensPendentes();
  // Fila travada por uma falha definitiva (de qualquer rota): nada anda, então o dado não está "a caminho".
  if (fila.some((i) => i.falhou)) return false;
  return fila.some((i) => i.metodo === metodo && i.caminho === caminho);
}
