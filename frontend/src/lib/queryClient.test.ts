import { ApiError } from '@/api/errors';
import { criarQueryClient, repetirLeitura } from './queryClient';

describe('criarQueryClient', () => {
  it('mutações usam networkMode always (offline cai na fila em vez de pausar); leituras mantêm o padrão', () => {
    const o = criarQueryClient().getDefaultOptions();
    expect(o.mutations?.networkMode).toBe('always');
    expect(o.queries?.networkMode).toBeUndefined(); // padrão 'online'
  });

  it('só repete leitura em rede e 5xx, no máximo 2 vezes', () => {
    expect(repetirLeitura(0, new ApiError(0, 'SEM_CONEXAO', 'x'))).toBe(true);
    expect(repetirLeitura(0, new ApiError(503, 'X', 'x'))).toBe(true);
    expect(repetirLeitura(0, new ApiError(404, 'X', 'x'))).toBe(false);
    expect(repetirLeitura(2, new ApiError(503, 'X', 'x'))).toBe(false);
  });
});
