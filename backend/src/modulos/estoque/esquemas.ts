// UC24 — formato do corpo das rotas de estoque.
import { z } from 'zod';
import { textoObrigatorio } from '../comum/campos';

/** Tamanho máximo do motivo do ajuste (coluna `movimentacao_estoque.motivo`, TEXT). */
export const TAMANHO_MAXIMO_DO_MOTIVO_DO_AJUSTE = 500;

/** Corpo de `POST /estoque/variacoes/:id/ajustes` (`AjusteEstoque` do frontend). */
export const esquemaDeAjusteEstoque = z.object({
  /** Positivo soma, negativo subtrai; nunca zero (não seria uma movimentação). */
  quantidade: z
    .number()
    .int()
    .refine((valor) => valor !== 0, 'A quantidade do ajuste não pode ser zero.'),
  motivo: textoObrigatorio(TAMANHO_MAXIMO_DO_MOTIVO_DO_AJUSTE),
});
export type DadosDoAjusteDeEstoque = z.infer<typeof esquemaDeAjusteEstoque>;
