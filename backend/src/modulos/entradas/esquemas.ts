// UC04 (passos 6-8) — formato do corpo de `POST /entradas-mercadoria` (RF19).
import { z } from 'zod';
import { esquemaDeId, esquemaDeQuantidade, textoOpcional } from '../comum/campos';

/** Tamanho da coluna `entrada_mercadoria.numero_cotacao_compra` (referência externa). */
export const TAMANHO_MAXIMO_DO_NUMERO_DA_COTACAO = 30;
/** Tamanho máximo do nome de usuário informado na liberação (coluna `operador.usuario`). */
export const TAMANHO_MAXIMO_DO_USUARIO_DE_LIBERACAO = 50;

/** Credenciais do operador chefe para liberar a divergência (RF19). */
export const esquemaDeLiberacao = z.object({
  usuario: z.string().trim().min(1).max(TAMANHO_MAXIMO_DO_USUARIO_DE_LIBERACAO),
  senha: z.string().min(1),
});

/** Corpo de `POST /entradas-mercadoria` (`EntradaMercadoriaNova` do frontend). */
export const esquemaDeEntradaNova = z.object({
  idFornecedor: esquemaDeId,
  idVariacao: esquemaDeId,
  numeroCotacaoCompra: textoOpcional(TAMANHO_MAXIMO_DO_NUMERO_DA_COTACAO),
  quantidadeComprada: esquemaDeQuantidade,
  quantidadeInformada: esquemaDeQuantidade,
  liberacao: esquemaDeLiberacao.optional(),
});
export type DadosDaEntradaNova = z.infer<typeof esquemaDeEntradaNova>;
