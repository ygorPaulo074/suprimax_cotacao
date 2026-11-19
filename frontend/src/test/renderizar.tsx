import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';

/** Renderiza uma tela com roteador de dados em memória e um TanStack Query sem novas tentativas. */
export function renderizarTela(tela: ReactElement, rota = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Roteador de dados (como em `main.tsx`): `useBlocker` só funciona nele.
  const roteador = createMemoryRouter([{ path: '*', element: tela }], {
    initialEntries: [rota],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>,
  );
}
