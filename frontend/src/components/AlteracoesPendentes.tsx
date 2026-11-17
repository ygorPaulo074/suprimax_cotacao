import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  assinarFila,
  configurarFila,
  lerOrcamentoAberto,
  processarFila,
  quantidadePendente,
  salvarOrcamentoAberto,
  versaoDaFila,
  type OrcamentoDetalhe,
} from '@/api';
import { Alerta } from '@/components/ui';

const INTERVALO_REENVIO_MS = 30_000;

/**
 * RNF06: liga a fila de alterações sem conexão ao TanStack Query, reenvia ao voltar a rede
 * (evento online + tentativa a cada 30 s) e mostra o indicador de pendências (docs/10, 10.7).
 */
export default function AlteracoesPendentes() {
  const queryClient = useQueryClient();
  const [avisos, setAvisos] = useState<{ id: number; texto: string }[]>([]);
  useSyncExternalStore(assinarFila, versaoDaFila);
  const pendentes = quantidadePendente();

  useEffect(() => {
    configurarFila({
      // A fila só descarta o item depois desta releitura.
      reler: () => queryClient.invalidateQueries({ queryKey: ['orcamentos'] }),
      descartado: (_item, erro) =>
        setAvisos((a) => [
          ...a,
          {
            id: Date.now() + a.length,
            texto: `Uma alteração feita sem conexão foi recusada e descartada: ${erro.message}`,
          },
        ]),
    });
    // Orçamento aberto continua visível offline: parte do cache, mas já "velho" para reler quando der.
    const salvo = lerOrcamentoAberto();
    if (salvo && !queryClient.getQueryData(['orcamentos', salvo.id]))
      queryClient.setQueryData(['orcamentos', salvo.id], salvo.dados, { updatedAt: 0 });
    const cancelar = queryClient.getQueryCache().subscribe((e) => {
      const chave = e.query.queryKey;
      if (
        e.type === 'updated' &&
        e.action.type === 'success' &&
        chave.length === 2 &&
        chave[0] === 'orcamentos' &&
        typeof chave[1] === 'number'
      )
        salvarOrcamentoAberto(chave[1], e.query.state.data as OrcamentoDetalhe);
    });
    const tentar = () => void processarFila();
    window.addEventListener('online', tentar);
    const timer = window.setInterval(() => {
      if (quantidadePendente() > 0) tentar();
    }, INTERVALO_REENVIO_MS);
    tentar();
    return () => {
      cancelar();
      window.removeEventListener('online', tentar);
      window.clearInterval(timer);
    };
  }, [queryClient]);

  return (
    <>
      {pendentes > 0 && (
        <span
          role="status"
          className="flex items-center gap-1.5 rounded-full bg-laranja px-3 py-1 text-xs font-bold text-white"
        >
          <span aria-hidden="true">⟳</span>
          {pendentes === 1 ? '1 alteração pendente' : `${pendentes} alterações pendentes`}
        </span>
      )}
      {avisos.length > 0 && (
        <div className="fixed bottom-4 right-4 z-20 flex max-w-sm flex-col gap-2">
          {avisos.map((a) => (
            <div key={a.id} className="bg-white shadow-md">
              <Alerta>
                <span>{a.texto}</span>
                <button
                  type="button"
                  className="ml-2 text-xs underline"
                  onClick={() => setAvisos((l) => l.filter((x) => x.id !== a.id))}
                >
                  Fechar
                </button>
              </Alerta>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
