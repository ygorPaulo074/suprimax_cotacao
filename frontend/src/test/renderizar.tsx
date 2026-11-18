import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

/** Renderiza uma tela com roteador em memória e um TanStack Query sem novas tentativas. */
export function renderizarTela(tela: ReactElement, rota = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[rota]}>{tela}</MemoryRouter>
    </QueryClientProvider>,
  );
}
