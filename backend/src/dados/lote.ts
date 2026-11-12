// Item 5 do backend/TAREFAS.md — gravações que precisam valer juntas: `dados.lote` executa os
// passos em uma transação única (comunicacao-backend-proxy.md, seção 4; docs/12, seção 12.8.2).
import { ErroInterno } from '../erros';
import { linhasDe } from './consultas';
import type { ClienteDeProxy } from './proxyCliente';

/** Máximo de passos de um `dados.lote`. */
export const MAXIMO_DE_PASSOS_DO_LOTE = 20;

/** Operações aceitas dentro de um lote. */
export type OperacaoDeLote =
  'dados.consultar' | 'dados.inserir' | 'dados.atualizar' | 'dados.excluir';

/** Um passo do lote. O `id` segue o padrão de identificador do proxy: `[a-z_][a-z0-9_]*`. */
export interface PassoDoLote {
  readonly id: string;
  readonly operacao: OperacaoDeLote;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Resultado de cada passo, indexado pelo id do passo. As linhas vêm com chaves em camelCase. */
export type ResultadosDoLote = Readonly<Record<string, unknown>>;

/**
 * Texto que o proxy troca pelo valor devolvido por um passo anterior do mesmo lote.
 *
 * @param idDoPasso Passo que devolveu a linha (precisa de `retornar`).
 * @param indice Posição da linha em `dados`.
 * @param coluna Coluna da linha, em snake_case.
 * @example referenciaAoPasso('cliente', 0, 'id_cliente') // '$cliente.dados[0].id_cliente'
 */
export function referenciaAoPasso(idDoPasso: string, indice: number, coluna: string): string {
  return `$${idDoPasso}.dados[${indice}].${coluna}`;
}

/** Linhas devolvidas por um passo do lote. */
export function linhasDoPasso(resultados: ResultadosDoLote, idDoPasso: string): unknown[] {
  return linhasDe(resultados[idDoPasso]);
}

/**
 * Executa os passos em uma única transação: ou todos valem, ou nenhum.
 *
 * @throws {ErroInterno} Se a lista estiver vazia ou passar de MAXIMO_DE_PASSOS_DO_LOTE.
 */
export async function executarLote(
  proxy: ClienteDeProxy,
  passos: readonly PassoDoLote[],
  operationId: string,
): Promise<ResultadosDoLote> {
  if (passos.length === 0 || passos.length > MAXIMO_DE_PASSOS_DO_LOTE) {
    throw new ErroInterno(
      new Error(
        `Lote com ${passos.length} passos (${operationId}); o proxy aceita de 1 a ${MAXIMO_DE_PASSOS_DO_LOTE}.`,
      ),
    );
  }
  const resposta = await proxy.executar<{ resultados?: ResultadosDoLote }>(
    'dados.lote',
    { passos },
    operationId,
  );
  return resposta.resultados ?? {};
}

/**
 * Executa grupos de passos em um ou mais lotes, na ordem. Um grupo nunca é dividido: seus passos
 * ficam na mesma transação. Grupos diferentes podem cair em transações diferentes quando o total
 * passa de MAXIMO_DE_PASSOS_DO_LOTE; nesse caso, se um lote falhar, os anteriores já valeram.
 * Por isso, ordene os grupos de modo que cada lote deixe os dados em estado válido.
 *
 * @returns Os resultados de todos os passos, indexados pelo id do passo.
 * @throws {ErroInterno} Se um grupo sozinho não couber em um lote.
 */
export async function executarEmLotes(
  proxy: ClienteDeProxy,
  grupos: readonly (readonly PassoDoLote[])[],
  operationId: string,
): Promise<ResultadosDoLote> {
  const resultados: Record<string, unknown> = {};
  for (const lote of agruparEmLotes(grupos)) {
    Object.assign(resultados, await executarLote(proxy, lote, operationId));
  }
  return resultados;
}

/** Distribui os grupos em lotes de até MAXIMO_DE_PASSOS_DO_LOTE passos, sem dividir um grupo. */
export function agruparEmLotes(grupos: readonly (readonly PassoDoLote[])[]): PassoDoLote[][] {
  const lotes: PassoDoLote[][] = [];
  let atual: PassoDoLote[] = [];
  for (const grupo of grupos) {
    if (grupo.length > MAXIMO_DE_PASSOS_DO_LOTE) {
      throw new ErroInterno(new Error(`Grupo de ${grupo.length} passos não cabe em um lote.`));
    }
    if (atual.length + grupo.length > MAXIMO_DE_PASSOS_DO_LOTE) {
      lotes.push(atual);
      atual = [];
    }
    atual.push(...grupo);
  }
  if (atual.length > 0) {
    lotes.push(atual);
  }
  return lotes;
}
