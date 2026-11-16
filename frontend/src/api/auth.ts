import { api } from './client';
import type { LoginRequest, LoginResponse, Sessao } from './types';

export const authApi = {
  /** 200 { token, usuario } | 401 CREDENCIAIS_INVALIDAS | 423 CONTA_BLOQUEADA (detalhes.bloqueadoAte). */
  login: (dados: LoginRequest) => api.post<LoginResponse>('/auth/login', dados),
  /** Sessão do token atual (perfil e permissões), usada ao recarregar a página. */
  me: () => api.get<Sessao>('/auth/me'),
  logout: () => api.post<void>('/auth/logout'),
  /** Envia o link de recuperação ao e-mail corporativo; a resposta é sempre 204. */
  recuperarSenha: (email: string) => api.post<void>('/auth/recuperar-senha', { email }),
  /** 204 | 422 TOKEN_RECUPERACAO_INVALIDO (inválido, expirado ou já usado). Encerra as sessões do operador. */
  redefinirSenha: (token: string, novaSenha: string) =>
    api.post<void>('/auth/redefinir-senha', { token, novaSenha }),
};
