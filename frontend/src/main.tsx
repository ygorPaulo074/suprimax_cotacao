import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthContext';
import { GateServicos } from '@/components/GateServicos';
import App from './App';
import { criarQueryClient } from './lib/queryClient';
import './index.css';

// Roteador de dados: necessário para `useBlocker` (aviso de alterações não salvas, RNF06).
const roteador = createBrowserRouter([
  {
    path: '*',
    // Página de aguardo: o sistema só abre quando todos os serviços respondem (só em produção; em
    // desenvolvimento abre direto). Fica fora do AuthProvider para nada chamar a API antes disso.
    element: (
      <GateServicos ativo={import.meta.env.PROD}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </GateServicos>
    ),
  },
]);

const queryClient = criarQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>
  </StrictMode>,
);
