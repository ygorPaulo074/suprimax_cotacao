import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router-dom';

export interface AvisoNaoSalvo {
  /** Estado do bloqueio de navegação (a tela mostra a confirmação quando `state === 'blocked'`). */
  bloqueio: Blocker;
  /**
   * Libera a PRÓXIMA saída sem aviso. Chamar logo antes de navegar de propósito (depois de salvar
   * com sucesso ou ao clicar em Cancelar): o `sujo` desse render ainda é verdadeiro, então sem isto
   * a própria saída planejada seria bloqueada.
   */
  liberar: () => void;
}

/**
 * RNF06: avisa antes de perder texto digitado e não salvo. Bloqueia a navegação entre telas
 * (devolve o `Blocker` para a tela mostrar a confirmação) e o fechamento/recarga da aba
 * (`beforeunload`). Só atua enquanto `sujo` for verdadeiro.
 */
export function useAvisoNaoSalvo(sujo: boolean): AvisoNaoSalvo {
  const liberado = useRef(false);
  const bloqueio = useBlocker(
    ({ currentLocation, nextLocation }) =>
      sujo && !liberado.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!sujo) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      if (liberado.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aoSair);
    return () => window.removeEventListener('beforeunload', aoSair);
  }, [sujo]);
  const liberar = useCallback(() => {
    liberado.current = true;
  }, []);
  return { bloqueio, liberar };
}

/** Texto (ou nulo) comparável: sem espaços nas pontas, nulo e vazio iguais. */
export const textoNormalizado = (v: string | null | undefined): string => (v ?? '').trim();
