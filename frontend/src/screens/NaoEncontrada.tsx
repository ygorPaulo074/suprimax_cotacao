import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { rotaInicial } from '@/lib/perfis';

/** Rota inexistente: aviso simples com o caminho de volta (tela inicial do perfil ou login). */
export default function NaoEncontrada() {
  const { sessao, carregando } = useAuth();
  if (carregando) return null;
  const destino = sessao ? rotaInicial(sessao.perfil) : '/login';
  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-300 bg-white p-8 text-center shadow-sm">
        <div className="text-4xl font-bold text-petroleo">404</div>
        <h1 className="mt-2 text-xl font-bold text-grafite">Página não encontrada</h1>
        <p className="mt-2 mb-6 text-sm text-gray-600">
          O endereço acessado não existe ou foi movido.
        </p>
        <Link to={destino} className="text-sm text-petroleo underline">
          {sessao ? 'Voltar à página inicial' : 'Ir para o login'}
        </Link>
      </div>
    </div>
  );
}
