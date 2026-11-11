// UC13 — formato do corpo das rotas de autenticação.
import { z } from 'zod';
import { ErroDeValidacao } from '../../erros';

/** Tamanho da coluna `operador.usuario`. */
export const TAMANHO_MAXIMO_DO_USUARIO = 50;
/** Teto do campo senha no corpo; a senha válida é limitada a 72 bytes pelo ServicoDeSenha. */
export const TAMANHO_MAXIMO_DO_CAMPO_SENHA = 200;

/**
 * Corpo de `POST /auth/login`. O mínimo de 8 caracteres (RN01) não é conferido aqui: vale ao
 * definir a senha, e não deve impedir o login de quem já tem uma.
 */
export const esquemaDeLogin = z.object({
  usuario: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_USUARIO),
  senha: z.string().min(1).max(TAMANHO_MAXIMO_DO_CAMPO_SENHA),
});

/**
 * Valida o corpo da requisição contra o esquema.
 *
 * @throws {ErroDeValidacao} Com `detalhes.campos` listando os campos recusados, sem os valores.
 */
export function validarCorpo<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const resultado = esquema.safeParse(corpo);
  if (!resultado.success) {
    const campos = [...new Set(resultado.error.issues.map(({ path }) => path.join('.')))];
    throw new ErroDeValidacao({ detalhes: { campos: campos.filter((campo) => campo !== '') } });
  }
  return resultado.data;
}
