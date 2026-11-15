// UC07 — formato do corpo das rotas de análise de crédito.
import { z } from 'zod';
import { esquemaDeDataISO } from '../comum/campos';
import { RESULTADOS_DE_CREDITO } from '../comum/situacaoCliente';
import { TIPOS_DE_DOCUMENTO_CREDITO } from './repositorio';

/**
 * Corpo de `POST /analises-credito/:id/documentos`: marca um tipo de documento do checklist
 * como recebido (`frontend/src/api/credito.ts`'s `registrarDocumento` — sem upload de arquivo).
 */
export const esquemaDeDocumentoRecebido = z.object({
  tipoDocumento: z.enum(TIPOS_DE_DOCUMENTO_CREDITO),
  dataRecebimento: esquemaDeDataISO,
});
export type DadosDoDocumentoRecebido = z.infer<typeof esquemaDeDocumentoRecebido>;

/** Corpo de `POST /analises-credito/:id/resultado`. */
export const esquemaDeResultadoDeCredito = z.object({
  resultado: z.enum(RESULTADOS_DE_CREDITO),
});
export type DadosDoResultadoDeCredito = z.infer<typeof esquemaDeResultadoDeCredito>;
