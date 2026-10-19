import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { respostasApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { itensDoMenu } from '@/lib/perfis';

const ROTULO_PERFIL: Record<string, string> = {
  OPERADOR: 'Operador',
  OPERADOR_CHEFE: 'Operador chefe',
  FISCAL: 'Fiscal',
  FINANCEIRO: 'Financeiro',
  VENDEDOR: 'Vendedor',
  GESTOR: 'Gestor',
};

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-md bg-white/20 text-lg"
      >
        🛒
      </span>
      <span className="text-lg font-bold tracking-tight text-white">SupriMax</span>
    </div>
  );
}

/** Moldura das telas autenticadas: barra superior, menu por perfil e área de conteúdo (docs/10, 10.2). */
export default function AppShell() {
  const { sessao, sair } = useAuth();
  const navegar = useNavigate();
  const menu = sessao ? itensDoMenu(sessao.perfil) : [];
  const mostraContador = menu.some((i) => i.id === 'respostas');
  const contador = useQuery({
    queryKey: ['respostas', 'contador'],
    queryFn: respostasApi.contar,
    enabled: mostraContador,
    refetchInterval: 60_000,
  });

  if (!sessao) return null;
  const iniciais = sessao.nome
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-10 flex h-14 shrink-0 items-center gap-5 bg-petroleo px-6 shadow-md">
        <Logo />
        <form
          role="search"
          className="ml-6 max-w-md flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            const termo = new FormData(e.currentTarget).get('busca');
            if (typeof termo === 'string' && termo.trim())
              navegar(`/orcamentos?cliente=${encodeURIComponent(termo.trim())}`);
          }}
        >
          <input
            name="busca"
            aria-label="Busca global"
            placeholder="Busca global (cliente, nº orçamento, CNPJ...)"
            className="w-full rounded-md border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm text-white outline-none placeholder:text-white/60"
          />
        </form>
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2 text-white">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/20 text-sm font-bold">
              {iniciais}
            </span>
            <div className="text-sm">
              <div className="font-semibold">{sessao.nome}</div>
              <div className="text-xs opacity-75">
                {ROTULO_PERFIL[sessao.perfil] ?? sessao.perfil}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void sair().then(() => navegar('/login'))}
            className="rounded-md border border-white/20 bg-white/10 px-3 py-1 text-xs text-white"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <nav aria-label="Menu principal" className="flex w-60 shrink-0 flex-col bg-petroleo py-4">
          {menu.map((item) => (
            <NavLink
              key={item.id}
              to={item.caminho}
              className={({ isActive }) =>
                `flex items-center justify-between px-5 py-2.5 text-sm text-white ${
                  isActive
                    ? 'border-l-4 border-verde bg-white/15 font-semibold'
                    : 'border-l-4 border-transparent opacity-85 hover:bg-white/10'
                }`
              }
            >
              {item.rotulo}
              {item.id === 'respostas' && !!contador.data?.total && (
                <span className="rounded-full bg-laranja px-2 py-0.5 text-xs font-bold text-white">
                  {contador.data.total}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 bg-off-white">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
