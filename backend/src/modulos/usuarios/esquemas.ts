// UC25 — formato do corpo das rotas de usuários.
import { z } from 'zod';
import { TAMANHO_MAXIMO_DO_USUARIO } from '../auth/esquemas';
import { STATUS_DO_USUARIO } from '../auth/operadores';
import { PERFIS } from '../auth/sessoes';
import { esquemaDeEmail, esquemaDeId, textoObrigatorio } from '../comum/campos';

/**
 * Corpo de `POST /usuarios`. A senha não vem aqui: o usuário a define pelo link enviado ao
 * e-mail. O e-mail é guardado em minúsculas, para que a mesma caixa não seja cadastrada duas vezes.
 */
export const esquemaDeUsuarioNovo = z.object({
  usuario: textoObrigatorio(TAMANHO_MAXIMO_DO_USUARIO),
  email: esquemaDeEmail.transform((email) => email.toLowerCase()),
  perfil: z.enum(PERFIS),
});
export type DadosDoUsuarioNovo = z.infer<typeof esquemaDeUsuarioNovo>;

/** Corpo de `PATCH /usuarios/:id`: muda o perfil, o status ou os dois. */
export const esquemaDeUsuarioAtualizar = z
  .object({
    perfil: z.enum(PERFIS).optional(),
    status: z.enum(STATUS_DO_USUARIO).optional(),
    /** Quem recebe a carteira quando o vendedor é inativado ou muda de perfil. */
    idNovoVendedor: esquemaDeId.optional(),
  })
  .refine(({ perfil, status }) => perfil !== undefined || status !== undefined, {
    path: ['status'],
  });
export type DadosDoUsuarioAtualizar = z.infer<typeof esquemaDeUsuarioAtualizar>;
