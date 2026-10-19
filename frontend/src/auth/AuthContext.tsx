import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  aoReceberNaoAutorizado,
  authApi,
  definirToken,
  type LoginRequest,
  type Sessao,
} from '@/api';

const CHAVE_TOKEN = 'suprimax.token';

// O token fica só na aba (sessionStorage). Se o armazenamento estiver bloqueado, a sessão vale até recarregar.
function lerTokenSalvo(): string | null {
  try {
    return sessionStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}
function salvarToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(CHAVE_TOKEN, token);
    else sessionStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* sem armazenamento: segue sem persistir */
  }
}

interface AuthValor {
  sessao: Sessao | null;
  /** true enquanto valida o token salvo ao carregar a página. */
  carregando: boolean;
  entrar: (dados: LoginRequest) => Promise<Sessao>;
  sair: () => Promise<void>;
}

const AuthContext = createContext<AuthValor | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(() => lerTokenSalvo() !== null);

  const limpar = useCallback(() => {
    definirToken(null);
    salvarToken(null);
    setSessao(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    aoReceberNaoAutorizado(limpar); // 401 em qualquer chamada encerra a sessão
    return () => aoReceberNaoAutorizado(null);
  }, [limpar]);

  useEffect(() => {
    const salvo = lerTokenSalvo();
    if (!salvo) return;
    definirToken(salvo);
    authApi
      .me()
      .then(setSessao)
      .catch(limpar)
      .finally(() => setCarregando(false));
  }, [limpar]);

  const entrar = useCallback(async (dados: LoginRequest) => {
    const { token, usuario } = await authApi.login(dados);
    definirToken(token);
    salvarToken(token);
    setSessao(usuario);
    return usuario;
  }, []);

  const sair = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    limpar();
  }, [limpar]);

  const valor = useMemo(
    () => ({ sessao, carregando, entrar, sair }),
    [sessao, carregando, entrar, sair],
  );
  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValor {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
