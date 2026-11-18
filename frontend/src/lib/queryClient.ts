import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

/** Repetir só vale para rede e 5xx: erros 4xx são da requisição (regra de negócio, permissão). */
export function repetirLeitura(tentativas: number, erro: unknown): boolean {
  return tentativas < 2 && (!(erro instanceof ApiError) || erro.status === 0 || erro.status >= 500);
}

export function criarQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: repetirLeitura },
      // RNF06: com `navigator.onLine` falso o padrão ('online') pausaria a mutação e o botão
      // ficaria preso. 'always' deixa o fetch falhar e o cliente HTTP guardar na fila offline
      // (só mutações de orçamento com id e Idempotency-Key; as demais mostram "sem conexão").
      // Leituras mantêm o padrão: pausam offline e retomam ao voltar a rede.
      mutations: { networkMode: 'always' },
    },
  });
}
