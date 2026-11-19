import { useSyncExternalStore } from 'react';
import { assinarLentidao, haLeituraLenta } from '@/api';

/** RNF06: leitura sem resposta há ~15 s (servidor acordando no plano gratuito): avisa em vez de esperar calado. */
export default function AvisoServidorLento() {
  const lento = useSyncExternalStore(assinarLentidao, haLeituraLenta);
  if (!lento) return null;
  return (
    <span role="status" className="text-xs text-white">
      O servidor está demorando para responder…
    </span>
  );
}
