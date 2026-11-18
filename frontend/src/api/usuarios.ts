import { api } from './client';
import type { Usuario, UsuarioAtualizar, UsuarioNovo } from './types';

export const usuariosApi = {
  listar: () => api.get<Usuario[]>('/usuarios'),
  /** O usuário recebe por e-mail o link para definir a senha. */
  criar: (dados: UsuarioNovo) => api.post<Usuario>('/usuarios', dados),
  /** Aceita `perfil`, `status` e `email`. 409 USUARIO_JA_CADASTRADO se o e-mail já for de outro usuário.
   * 422 NOVO_VENDEDOR_OBRIGATORIO ao inativar vendedor com clientes na carteira sem `idNovoVendedor`. */
  atualizar: (idOperador: number, dados: UsuarioAtualizar) =>
    api.patch<Usuario>(`/usuarios/${idOperador}`, dados),
};
