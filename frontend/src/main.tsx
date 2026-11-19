import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/auth/AuthContext';
import App from './App';
import { criarQueryClient } from './lib/queryClient';
import './index.css';

// Roteador de dados: necessário para `useBlocker` (aviso de alterações não salvas, RNF06).
const roteador = createBrowserRouter([
  {
    path: '*',
    element: (
      <AuthProvider>
        <App />
      </AuthProvider>
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
