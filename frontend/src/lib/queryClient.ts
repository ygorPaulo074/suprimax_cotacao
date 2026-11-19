import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';

/** Repetir só vale para rede e 5xx: erros 4xx são da requisição (regra de negócio, permissão). */
export function repetirLeitura(tentativas: number, erro: unknown): boolean {
  return tentativas < 2 && (!(erro instanceof ApiError) || erro.status === 0 || erro.status >= 500);
}

export function criarQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // RNF06: com `navigator.onLine` falso o padrão ('online') pausaria a leitura e a tela ficaria
      // em esqueleto para sempre, sem mensagem. 'always' deixa o fetch falhar e a tela cai em
      // "Sem conexão com o servidor. Tente novamente." (`ErroRequisicao`).
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: repetirLeitura,
        networkMode: 'always',
      },
      // RNF06: com `navigator.onLine` falso o padrão ('online') pausaria a mutação e o botão
      // ficaria preso. 'always' deixa o fetch falhar e o cliente HTTP guardar na fila offline
      // (só mutações de orçamento com id e Idempotency-Key; as demais mostram "sem conexão").
      mutations: { networkMode: 'always' },
    },
  });
}
