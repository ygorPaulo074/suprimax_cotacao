// UC13 — formato do corpo das rotas de autenticação.
import { z } from 'zod';
import { esquemaDeEmail } from '../comum/campos';

/** Tamanho da coluna `operador.usuario`. */
export const TAMANHO_MAXIMO_DO_USUARIO = 50;
/** Teto do campo senha no corpo; a senha válida é limitada a 72 bytes pelo ServicoDeSenha. */
export const TAMANHO_MAXIMO_DO_CAMPO_SENHA = 200;
/** Senha mínima (RN01), conferida ao definir ou redefinir a senha. */
export const TAMANHO_MINIMO_DA_SENHA = 8;
/** Teto de tamanho para o texto do token recebido no corpo (o token real tem 43 caracteres). */
export const TAMANHO_MAXIMO_DO_TOKEN = 500;

/**
 * Corpo de `POST /auth/login`. O mínimo de 8 caracteres (RN01) não é conferido aqui: vale ao
 * definir a senha, e não deve impedir o login de quem já tem uma.
 */
export const esquemaDeLogin = z.object({
  usuario: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_USUARIO),
  senha: z.string().min(1).max(TAMANHO_MAXIMO_DO_CAMPO_SENHA),
});

/** Corpo de `POST /auth/recuperar-senha`: `{ email }`. Sempre responde 204, exista ou não a conta. */
export const esquemaDeRecuperarSenha = z.object({
  email: esquemaDeEmail,
});
export type DadosDeRecuperarSenha = z.infer<typeof esquemaDeRecuperarSenha>;

/**
 * Corpo de `POST /auth/redefinir-senha`: `{ token, novaSenha }`. O mínimo de 8 caracteres (RN01)
 * é conferido aqui, porque é aqui que a senha nasce.
 */
export const esquemaDeRedefinirSenha = z.object({
  token: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_TOKEN),
  novaSenha: z.string().min(TAMANHO_MINIMO_DA_SENHA).max(TAMANHO_MAXIMO_DO_CAMPO_SENHA),
});
export type DadosDeRedefinirSenha = z.infer<typeof esquemaDeRedefinirSenha>;
