// UC21 — esquemas zod do módulo de respostas pendentes.
import { z } from 'zod';
import { esquemaDeIdNaRota } from '../comum/campos';
import { MOTIVOS_DE_TRATAMENTO } from './repositorio';

/**
 * `GET /respostas-pendentes`: filtros da listagem (UC21). `tipo` é o que o frontend chama de
 * `TipoRespostaPendente` — na prática o `motivo_tratamento` da resposta (docs/frontend-api.md,
 * linha 46), não o `tipo_resposta` bruto.
 */
export const esquemaDeFiltroDeRespostas = z.object({
  tipo: z.enum(MOTIVOS_DE_TRATAMENTO).optional(),
  idVendedor: esquemaDeIdNaRota.optional(),
});

export type FiltroDeRespostasQuery = z.infer<typeof esquemaDeFiltroDeRespostas>;
