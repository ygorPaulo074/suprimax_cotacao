import { useEffect } from 'react';
import { useBlocker, type Blocker } from 'react-router-dom';

/**
 * RNF06: avisa antes de perder texto digitado e não salvo. Bloqueia a navegação entre telas
 * (devolve o `Blocker` para a tela mostrar a confirmação) e o fechamento/recarga da aba
 * (`beforeunload`). Só atua enquanto `sujo` for verdadeiro.
 */
export function useAvisoNaoSalvo(sujo: boolean): Blocker {
  const bloqueio = useBlocker(
    ({ currentLocation, nextLocation }) =>
      sujo && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!sujo) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', aoSair);
    return () => window.removeEventListener('beforeunload', aoSair);
  }, [sujo]);
  return bloqueio;
}
