// UC10 — esquemas zod da fila de pedidos.
import { z } from 'zod';
import { textoObrigatorio } from '../comum/campos';
import { STATUS_DO_PEDIDO } from './repositorio';

/** Tamanho máximo do motivo de negativa (mesmo limite de `observacoes`, docs/13 seção 13.7.9). */
export const TAMANHO_MAXIMO_DO_MOTIVO = 500;

/** `GET /pedidos?status=`; sem o parâmetro, vêm todos. */
export const esquemaDeFiltroDePedidos = z.object({
  status: z.enum(STATUS_DO_PEDIDO).optional(),
});

/** `POST /pedidos/:id/negar`. */
export const esquemaDeNegativa = z.object({
  motivo: textoObrigatorio(TAMANHO_MAXIMO_DO_MOTIVO),
});

export type FiltroDePedidos = z.infer<typeof esquemaDeFiltroDePedidos>;
export type DadosDaNegativa = z.infer<typeof esquemaDeNegativa>;
