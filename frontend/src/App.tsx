import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RotaProtegida } from '@/auth/RotaProtegida';
import { useAuth } from '@/auth/AuthContext';
import { perfisDoModulo, rotaInicial } from '@/lib/perfis';
import AppShell from '@/layout/AppShell';
import Login from '@/screens/Login';
import SemAcesso from '@/screens/SemAcesso';
import Pedidos from '@/screens/Pedidos';
import AnalisePedido from '@/screens/AnalisePedido';
import Clientes from '@/screens/Clientes';
import CadastroCliente from '@/screens/CadastroCliente';
import Orcamento from '@/screens/Orcamento';
import OrcamentosLista from '@/screens/OrcamentosLista';
import RespostasPendentes from '@/screens/RespostasPendentes';
import TratarResposta from '@/screens/TratarResposta';
import AnaliseCredito from '@/screens/AnaliseCredito';
import Dividas from '@/screens/Dividas';
import Produtos from '@/screens/Produtos';
import AjusteEstoque from '@/screens/AjusteEstoque';
import EntradaMercadoria from '@/screens/EntradaMercadoria';
import Fornecedores from '@/screens/Fornecedores';
import Usuarios from '@/screens/Usuarios';

const Componentes = lazy(() => import('@/screens/Componentes'));

function Raiz() {
  const { sessao, carregando } = useAuth();
  if (carregando) return null;
  return <Navigate to={sessao ? rotaInicial(sessao.perfil) : '/login'} replace />;
}

/** Rotas por módulo; cada grupo exige os perfis definidos em docs/10, seção 10.2. */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Raiz />} />
      <Route path="/login" element={<Login />} />
      <Route element={<RotaProtegida />}>
        <Route path="/sem-acesso" element={<SemAcesso />} />
        <Route element={<AppShell />}>
          <Route element={<RotaProtegida perfis={perfisDoModulo('pedidos')} />}>
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/pedidos/:id" element={<AnalisePedido />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('clientes')} />}>
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/clientes/novo" element={<CadastroCliente />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('orcamentos')} />}>
            <Route path="/orcamentos" element={<OrcamentosLista />} />
            <Route path="/orcamentos/:id" element={<Orcamento />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('respostas')} />}>
            <Route path="/respostas" element={<RespostasPendentes />} />
            <Route path="/respostas/:id" element={<TratarResposta />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('produtos')} />}>
            <Route path="/produtos" element={<Produtos />} />
          </Route>
          <Route element={<RotaProtegida perfis={['OPERADOR_CHEFE']} />}>
            <Route path="/estoque" element={<AjusteEstoque />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('entrada')} />}>
            <Route path="/entrada-mercadoria" element={<EntradaMercadoria />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('fornecedores')} />}>
            <Route path="/fornecedores" element={<Fornecedores />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('credito')} />}>
            <Route path="/credito" element={<AnaliseCredito />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('dividas')} />}>
            <Route path="/dividas" element={<Dividas />} />
          </Route>
          <Route element={<RotaProtegida perfis={perfisDoModulo('usuarios')} />}>
            <Route path="/usuarios" element={<Usuarios />} />
          </Route>
          {import.meta.env.DEV && (
            <Route
              path="/componentes"
              element={
                <Suspense fallback={null}>
                  <Componentes />
                </Suspense>
              }
            />
          )}
        </Route>
      </Route>
      <Route path="*" element={<Raiz />} />
    </Routes>
  );
}
