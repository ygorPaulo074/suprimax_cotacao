// UC23 — formato do corpo das rotas de dívidas.
import { z } from 'zod';
import { esquemaDeCentavos, esquemaDeDataISO, esquemaDeId } from '../comum/campos';

/** Valor da dívida: centavos, maior que zero (CHECK do banco). */
const esquemaDoValorDaDivida = esquemaDeCentavos.refine(
  (valor) => valor > 0,
  'O valor da dívida deve ser maior que zero.',
);

/** Corpo de `POST /dividas`: o registro de uma dívida nova (`DividaNova` do frontend). */
export const esquemaDeDividaNova = z.object({
  idCliente: esquemaDeId,
  valorDivida: esquemaDoValorDaDivida,
  dataVencimentoOriginal: esquemaDeDataISO,
});
export type DadosDaDividaNova = z.infer<typeof esquemaDeDividaNova>;

/** Corpo de `POST /dividas/:id/renegociar` (`Renegociacao` do frontend). */
export const esquemaDeRenegociacao = z.object({
  dataRenegociacao: esquemaDeDataISO,
  valorPago: esquemaDeCentavos,
});
export type DadosDaRenegociacao = z.infer<typeof esquemaDeRenegociacao>;
