import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/api';
import { AuthProvider } from '@/auth/AuthContext';
import App from './App';
import './index.css';

// Erros 4xx são da requisição (regra de negócio, permissão): não adianta repetir. Só rede e 5xx.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (tentativas, erro) =>
        tentativas < 2 && (!(erro instanceof ApiError) || erro.status === 0 || erro.status >= 500),
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
