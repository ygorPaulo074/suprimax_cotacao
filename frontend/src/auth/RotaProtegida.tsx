import { Navigate, Outlet } from 'react-router-dom';
import type { Perfil } from '@/api';
import { rotaInicial } from '@/lib/perfis';
import { useAuth } from './AuthContext';
import { Skeleton } from '@/components/ui';

/** Exige sessão e, se informado, um dos perfis. A autorização real é feita pelo backend. */
export function RotaProtegida({ perfis }: { perfis?: Perfil[] }) {
  const { sessao, carregando } = useAuth();
  if (carregando) {
    return (
      <div className="p-10">
        <Skeleton className="h-6 w-64" />
      </div>
    );
  }
  if (!sessao) return <Navigate to="/login" replace />;
  if (perfis && !perfis.includes(sessao.perfil))
    return <Navigate to={rotaInicial(sessao.perfil)} replace />;
  return <Outlet />;
}
