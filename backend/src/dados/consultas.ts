// Item 5 do backend/TAREFAS.md — apoio aos repositórios: limites do proxy, leitura paginada e
// validação das linhas recebidas (comunicacao-backend-proxy.md, seção 4; docs/12, seção 12.8.2).
import type { z } from 'zod';
import { ErroInterno } from '../erros';
import type { ClienteDeProxy } from './proxyCliente';

/** Máximo de linhas que `dados.consultar` devolve por página. */
export const LIMITE_DE_LINHAS_POR_PAGINA = 500;
/** Máximo de valores na lista de uma condição `em`. */
export const MAXIMO_DE_VALORES_NO_FILTRO_EM = 100;
/** Acima disso, `dados.atualizar` e `dados.excluir` são bloqueados (`RISCO_ESTRUTURAL`). */
export const MAXIMO_DE_LINHAS_POR_ALTERACAO = 50;
/** Máximo de linhas de um `dados.inserir`. */
export const MAXIMO_DE_LINHAS_POR_INSERCAO = 100;
/**
 * Teto de páginas de uma leitura completa. Passar dele indica uma listagem que precisa de
 * paginação no contrato da rota, e não de mais memória: a leitura falha em vez de cortar o
 * resultado em silêncio.
 */
export const MAXIMO_DE_PAGINAS_POR_LEITURA = 40;

/** Condição de filtro do proxy: `[coluna, operador, valor]`. */
export type CondicaoDeFiltro = readonly [coluna: string, operador: string, valor?: unknown];
/** Grupo de condições: todas (`e`) ou qualquer uma (`ou`). */
export type FiltroDoProxy =
  | { readonly e: readonly (CondicaoDeFiltro | FiltroDoProxy)[] }
  | { readonly ou: readonly (CondicaoDeFiltro | FiltroDoProxy)[] };

/** Payload de `dados.consultar`, com nomes de tabelas e colunas em snake_case. */
export interface ConsultaAoProxy {
  readonly tabela: string;
  readonly campos?: readonly string[];
  readonly filtros?: FiltroDoProxy;
  readonly incluir?: readonly string[];
  readonly agrupar?: readonly string[];
  readonly agregacoes?: readonly { fn: string; campo: string; como: string }[];
  readonly ordenacao?: readonly (readonly [coluna: string, direcao: 'asc' | 'desc'])[];
  readonly limite?: number;
}

/** Linhas de uma resposta de `dados.consultar`, `dados.inserir` ou `dados.atualizar`. */
export function linhasDe(resposta: unknown): unknown[] {
  const dados = (resposta as { dados?: unknown } | null)?.dados;
  return Array.isArray(dados) ? dados : [];
}

/** Executa a consulta e devolve as linhas da primeira página. */
export async function consultar(
  proxy: ClienteDeProxy,
  consulta: ConsultaAoProxy,
  operationId: string,
): Promise<unknown[]> {
  return linhasDe(await proxy.executar('dados.consultar', { ...consulta }, operationId));
}

/**
 * Executa a consulta seguindo o cursor até a última página e devolve todas as linhas.
 *
 * @throws {ErroInterno} Se o resultado passar de MAXIMO_DE_PAGINAS_POR_LEITURA páginas.
 */
export async function consultarTodas(
  proxy: ClienteDeProxy,
  consulta: ConsultaAoProxy,
  operationId: string,
): Promise<unknown[]> {
  const linhas: unknown[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS_POR_LEITURA; pagina += 1) {
    const resposta = await proxy.executar<{ proximoCursor?: string | null }>(
      'dados.consultar',
      { limite: LIMITE_DE_LINHAS_POR_PAGINA, ...consulta, ...(cursor !== undefined && { cursor }) },
      operationId,
    );
    linhas.push(...linhasDe(resposta));
    if (typeof resposta.proximoCursor !== 'string') {
      return linhas;
    }
    cursor = resposta.proximoCursor;
  }
  throw new ErroInterno(
    new Error(`A leitura de "${consulta.tabela}" passou do teto de páginas (${operationId}).`),
  );
}

/**
 * Confere o formato de uma linha recebida do proxy. Uma linha fora do formato é defeito do
 * backend ou do schema, nunca culpa do usuário.
 *
 * @param origem Nome da tabela, para o log.
 * @throws {ErroInterno} Se a linha não seguir o esquema.
 */
export function validarLinha<T>(esquema: z.ZodType<T>, linha: unknown, origem: string): T {
  const resultado = esquema.safeParse(linha);
  if (!resultado.success) {
    const campos = resultado.error.issues.map(({ path }) => path.join('.')).join(', ');
    throw new ErroInterno(new Error(`Linha de "${origem}" fora do formato esperado: ${campos}.`));
  }
  return resultado.data;
}

/** Divide a lista em blocos de até `tamanho` itens, na ordem. */
export function emBlocos<T>(itens: readonly T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let inicio = 0; inicio < itens.length; inicio += tamanho) {
    blocos.push(itens.slice(inicio, inicio + tamanho));
  }
  return blocos;
}
