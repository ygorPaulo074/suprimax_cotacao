// UC17 — saldo disponível de uma ou mais variações: estoque físico menos as reservas vigentes
// (RN14; docs/11, seção 11.3). Usado pela montagem de orçamento (UC16/17) e pela busca de
// produtos dentro do orçamento (UC15). Substitui a simplificação do item 5
// (`saldoDisponivel = quantidadeEstoque`), agora que existem reservas de verdade.
import {
  consultarTodas,
  emBlocos,
  MAXIMO_DE_VALORES_NO_FILTRO_EM,
  validarLinha,
} from '../../dados';
import type { ClienteDeProxy } from '../../dados';
import { z } from 'zod';

const TABELA_DE_ITENS = 'item_orcamento';
const TABELA_DE_RESERVAS = 'reserva_estoque';

/** Único status de reserva que retira saldo do estoque disponível (RN14). */
export const STATUS_DE_RESERVA_VIGENTE = 'CONFIRMADA';
/** Reserva convertida em baixa de estoque no aceite do orçamento (UC20, seção 4.6). */
export const STATUS_DE_RESERVA_BAIXADA = 'BAIXADA';
/** Reserva devolvida ao estoque: cancelamento, recusa, substituição ou item não aprovado. */
export const STATUS_DE_RESERVA_LIBERADA = 'LIBERADA';

export const OPERACOES_DE_ESTOQUE = {
  SOMAR_RESERVAS: 'UC17-somar-reservas',
  LIBERAR_RESERVAS: 'UC06-liberar-reservas',
} as const;

const esquemaDoItem = z.object({ idItem: z.number().int(), idVariacao: z.number().int() });
const esquemaDaReserva = z.object({
  idItem: z.number().int(),
  quantidadeReservada: z.number().int(),
});

/**
 * Soma, por variação, a quantidade reservada em `reserva_estoque` com status CONFIRMADA. A
 * reserva não referencia a variação diretamente (passa por `item_orcamento`), então a conta é
 * feita em duas consultas e agrupada aqui — o proxy não agrega por uma coluna de outra tabela.
 *
 * Variações sem nenhuma reserva não aparecem no mapa (equivalente a reservado = 0).
 */
export async function somarReservasPorVariacao(
  proxy: ClienteDeProxy,
  idsDasVariacoes: readonly number[],
  operationId: string = OPERACOES_DE_ESTOQUE.SOMAR_RESERVAS,
): Promise<Map<number, number>> {
  const totalPorVariacao = new Map<number, number>();
  for (const bloco of emBlocos(idsDasVariacoes, MAXIMO_DE_VALORES_NO_FILTRO_EM)) {
    const linhasDeItens = await consultarTodas(
      proxy,
      {
        tabela: TABELA_DE_ITENS,
        campos: ['id_item', 'id_variacao'],
        filtros: { e: [['id_variacao', 'em', bloco]] },
      },
      operationId,
    );
    const itens = linhasDeItens.map((linha) => validarLinha(esquemaDoItem, linha, TABELA_DE_ITENS));
    if (itens.length === 0) {
      continue;
    }
    const variacaoDoItem = new Map(itens.map((item) => [item.idItem, item.idVariacao]));
    for (const blocoDeItens of emBlocos(
      [...variacaoDoItem.keys()],
      MAXIMO_DE_VALORES_NO_FILTRO_EM,
    )) {
      const linhasDeReservas = await consultarTodas(
        proxy,
        {
          tabela: TABELA_DE_RESERVAS,
          campos: ['id_item', 'quantidade_reservada'],
          filtros: {
            e: [
              ['id_item', 'em', blocoDeItens],
              ['status', '=', STATUS_DE_RESERVA_VIGENTE],
            ],
          },
        },
        operationId,
      );
      for (const linha of linhasDeReservas) {
        const reserva = validarLinha(esquemaDaReserva, linha, TABELA_DE_RESERVAS);
        const idVariacao = variacaoDoItem.get(reserva.idItem);
        if (idVariacao !== undefined) {
          totalPorVariacao.set(
            idVariacao,
            (totalPorVariacao.get(idVariacao) ?? 0) + reserva.quantidadeReservada,
          );
        }
      }
    }
  }
  return totalPorVariacao;
}

/** Saldo disponível = físico − reservado (RN14). Nunca aparece negativo. */
export function calcularSaldoDisponivel(quantidadeEstoque: number, reservado: number): number {
  return Math.max(0, quantidadeEstoque - reservado);
}

/**
 * Libera (CONFIRMADA → LIBERADA) as reservas vigentes dos itens informados. Usado no
 * cancelamento de um orçamento emitido (UC06), na recusa pelo cliente e na substituição por
 * nova versão (UC20/UC21) — a reserva nunca é excluída, só muda de status (docs/13, seção 4.6).
 *
 * Itens sem reserva vigente são ignorados silenciosamente (idempotente).
 */
export async function liberarReservasDosItens(
  proxy: ClienteDeProxy,
  idsDosItens: readonly number[],
  operationId: string = OPERACOES_DE_ESTOQUE.LIBERAR_RESERVAS,
): Promise<void> {
  for (const bloco of emBlocos(idsDosItens, MAXIMO_DE_VALORES_NO_FILTRO_EM)) {
    if (bloco.length === 0) {
      continue;
    }
    await proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_RESERVAS,
        filtros: {
          e: [
            ['id_item', 'em', bloco],
            ['status', '=', STATUS_DE_RESERVA_VIGENTE],
          ],
        },
        valores: { status: STATUS_DE_RESERVA_LIBERADA },
      },
      operationId,
    );
  }
}
