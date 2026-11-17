import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ApiError, authApi } from '@/api';
import { Alerta, BotaoPrimario, Campo } from '@/components/ui';

/** Mínimo de 8 caracteres (RN01); o backend confere de novo. */
const TAMANHO_MINIMO_DA_SENHA = 8;

function mensagemRedefinir(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.codigo === 'TOKEN_RECUPERACAO_INVALIDO')
      return 'O link de recuperação é inválido, expirou ou já foi usado. Solicite um novo link na tela de login.';
    if (erro.semConexao) return erro.message;
  }
  return 'Não foi possível redefinir a senha. Tente novamente.';
}

/** UC13 – Redefinição de senha. O token vem da URL (/redefinir-senha?token=...). */
export default function RedefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');

  const redefinir = useMutation({ mutationFn: () => authApi.redefinirSenha(token, senha) });

  const curta = senha !== '' && senha.length < TAMANHO_MINIMO_DA_SENHA;
  const diferente = confirmacao !== '' && confirmacao !== senha;
  const pode = token !== '' && senha.length >= TAMANHO_MINIMO_DA_SENHA && senha === confirmacao;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (pode) redefinir.mutate();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-300 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-petroleo">SupriMax</div>
          <div className="text-sm text-gray-500">Redefinir senha</div>
        </div>

        {redefinir.isSuccess ? (
          <div className="flex flex-col gap-4">
            <p role="status" className="text-sm text-gray-600">
              ✓ Senha redefinida. Entre com a nova senha.
            </p>
            <Link to="/login" className="text-sm text-petroleo underline">
              Ir para o login
            </Link>
          </div>
        ) : token === '' ? (
          <div className="flex flex-col gap-4">
            <Alerta>Link de recuperação incompleto. Solicite um novo link na tela de login.</Alerta>
            <Link to="/login" className="text-sm text-petroleo underline">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={enviar}>
            <Campo
              rotulo="Nova senha"
              type="password"
              autoComplete="new-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              erro={
                curta ? `A senha deve ter ao menos ${TAMANHO_MINIMO_DA_SENHA} caracteres.` : null
              }
            />
            <Campo
              rotulo="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              required
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              erro={diferente ? 'As senhas não coincidem.' : null}
            />
            {redefinir.isError && <Alerta>{mensagemRedefinir(redefinir.error)}</Alerta>}
            <BotaoPrimario type="submit" disabled={!pode || redefinir.isPending}>
              Redefinir senha
            </BotaoPrimario>
            <Link to="/login" className="text-center text-sm text-petroleo underline">
              Voltar ao login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
