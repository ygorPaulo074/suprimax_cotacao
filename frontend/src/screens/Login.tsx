import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError, authApi } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { rotaInicial, temAcessoAoSistema2 } from '@/lib/perfis';
import { formatarDataHora } from '@/lib/datas';
import { Alerta, BotaoPrimario, Campo } from '@/components/ui';

function mensagemLogin(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.codigo === 'CREDENCIAIS_INVALIDAS') return 'Usuário ou senha inválidos.';
    if (erro.codigo === 'CONTA_BLOQUEADA') {
      const ate = erro.detalhes?.bloqueadoAte;
      return `Conta bloqueada temporariamente após 3 tentativas inválidas${
        typeof ate === 'string' ? `. Tente novamente após ${formatarDataHora(ate)}` : ''
      }, ou solicite a recuperação de senha.`;
    }
    return erro.message;
  }
  return 'Não foi possível entrar. Tente novamente.';
}

/** Tela 1 — UC13 – Login. Única tela sem barra superior e sem menu. */
export default function Login() {
  const { sessao, entrar } = useAuth();
  const navegar = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [recuperando, setRecuperando] = useState(false);
  const [email, setEmail] = useState('');

  const login = useMutation({
    mutationFn: () => entrar({ usuario: usuario.trim(), senha }),
    onSuccess: (s) =>
      navegar(temAcessoAoSistema2(s.perfil) ? rotaInicial(s.perfil) : '/sem-acesso', {
        replace: true,
      }),
  });
  const recuperar = useMutation({ mutationFn: () => authApi.recuperarSenha(email.trim()) });

  if (sessao) return <Navigate to={rotaInicial(sessao.perfil)} replace />;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-300 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div aria-hidden="true" className="text-4xl">
            🛒
          </div>
          <div className="text-2xl font-bold text-petroleo">SupriMax</div>
          <div className="text-sm text-gray-500">Sistema de Cotação</div>
        </div>

        {recuperando ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              recuperar.mutate();
            }}
          >
            <Campo
              rotulo="E-mail corporativo"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {recuperar.isSuccess && (
              <p role="status" className="text-sm text-gray-600">
                ✓ Se o e-mail estiver cadastrado, enviamos o link de recuperação.
              </p>
            )}
            {recuperar.isError && <Alerta>Não foi possível enviar o link. Tente novamente.</Alerta>}
            <BotaoPrimario type="submit" disabled={recuperar.isPending || !email.trim()}>
              Enviar link
            </BotaoPrimario>
            <button
              type="button"
              className="text-sm text-petroleo underline"
              onClick={() => setRecuperando(false)}
            >
              Voltar ao login
            </button>
          </form>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={enviar}>
            <Campo
              rotulo="Usuário"
              autoComplete="username"
              required
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
            />
            <Campo
              rotulo="Senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            {login.isError && <Alerta>{mensagemLogin(login.error)}</Alerta>}
            <BotaoPrimario type="submit" disabled={login.isPending || !usuario.trim() || !senha}>
              Entrar
            </BotaoPrimario>
            <button
              type="button"
              className="text-sm text-petroleo underline"
              onClick={() => setRecuperando(true)}
            >
              Esqueci minha senha
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
