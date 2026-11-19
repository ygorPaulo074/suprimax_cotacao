// Paginação por cursor das listagens de orçamentos e pedidos (docs/frontend-api.md, "Paginação").
import { z } from 'zod';
import { esquemaDeId } from './campos';

/** Itens por página quando `depois` vem sem `limite`. */
export const LIMITE_PADRAO_DA_PAGINA = 50;
/** Maior `limite` aceito. */
export const LIMITE_MAXIMO_DA_PAGINA = 200;

/**
 * Parâmetros opcionais da query: `limite` (1 a 200) e `depois` (id do último item da página
 * anterior). Sem nenhum dos dois, a rota mantém o formato antigo, sem paginar.
 */
export const esquemaDeParametrosDePagina = z.object({
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_DA_PAGINA).optional(),
  depois: z.coerce.number().pipe(esquemaDeId).optional(),
});

export interface ParametrosDePagina {
  readonly limite: number;
  readonly depois?: number;
}

/** `null` quando a requisição não pediu paginação. */
export function lerParametrosDePagina(
  consulta: z.infer<typeof esquemaDeParametrosDePagina>,
): ParametrosDePagina | null {
  if (consulta.limite === undefined && consulta.depois === undefined) {
    return null;
  }
  return {
    limite: consulta.limite ?? LIMITE_PADRAO_DA_PAGINA,
    ...(consulta.depois !== undefined && { depois: consulta.depois }),
  };
}

/** Página de uma listagem: `proximo` é o valor de `depois` da página seguinte (ou `null`). */
export interface PaginaPorCursor<T> {
  readonly itens: readonly T[];
  readonly temMais: boolean;
  readonly proximo: number | null;
}
