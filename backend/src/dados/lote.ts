// Item 5 do backend/TAREFAS.md — gravações que precisam valer juntas: `dados.lote` executa os
// passos em uma transação única (comunicacao-backend-proxy.md, seção 4; docs/12, seção 12.8.2).
import { ErroInterno } from '../erros';
import { emBlocos, linhasDe } from './consultas';
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

/** Operação de leitura que o {@link LeitorEmLote} agrupa. */
const OPERACAO_DE_LEITURA = 'dados.consultar';

interface LeituraPendente {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly resolver: (resposta: unknown) => void;
  readonly rejeitar: (erro: unknown) => void;
}

/**
 * Cliente do proxy que junta as leituras (`dados.consultar`) pedidas ao mesmo tempo em um único
 * `dados.lote` (RNF03): cada rodada de leituras independentes, por exemplo as de um `Promise.all`,
 * custa uma chamada ao proxy em vez de uma por leitura. Uma leitura que depende do resultado de
 * outra cai na rodada seguinte, como já cairia sem o agrupamento.
 *
 * - Passa direto qualquer operação que não seja `dados.consultar`.
 * - Uma rodada com uma só leitura vai como `dados.consultar` comum (mantém a repetição
 *   automática de leituras do cliente); com mais de uma, vai como lote, em blocos de até
 *   MAXIMO_DE_PASSOS_DO_LOTE passos.
 * - Cada leitura recebe a mesma resposta que receberia sozinha (`{ dados, proximoCursor }`), então
 *   os repositórios e `consultarTodas` funcionam sem mudança. Se o lote falhar, todas as leituras
 *   da rodada recebem o erro.
 * - A rodada fecha no fim do turno atual do laço de eventos (`setTimeout` de 0 ms): tudo o que as
 *   funções em andamento pedirem sem esperar I/O entra nela.
 */
export class LeitorEmLote implements ClienteDeProxy {
  private pendentes: LeituraPendente[] = [];
  private agendado = false;

  constructor(
    private readonly proxy: ClienteDeProxy,
    /** Identificador de auditoria do lote (o das leituras avulsas continua o de cada leitura). */
    private readonly operationIdDoLote: string,
  ) {}

  async executar<T = unknown>(
    operacao: string,
    payload: Readonly<Record<string, unknown>>,
    operationId: string,
  ): Promise<T> {
    if (operacao !== OPERACAO_DE_LEITURA) {
      return this.proxy.executar<T>(operacao, payload, operationId);
    }
    return new Promise<T>((resolver, rejeitar) => {
      this.pendentes.push({ payload, resolver: resolver as (resposta: unknown) => void, rejeitar });
      if (!this.agendado) {
        this.agendado = true;
        setTimeout(() => void this.fecharRodada(operationId), 0);
      }
    });
  }

  private async fecharRodada(operationIdDaPrimeira: string): Promise<void> {
    const rodada = this.pendentes;
    this.pendentes = [];
    this.agendado = false;
    if (rodada.length === 1) {
      const [unica] = rodada as [LeituraPendente];
      try {
        unica.resolver(
          await this.proxy.executar(OPERACAO_DE_LEITURA, unica.payload, operationIdDaPrimeira),
        );
      } catch (erro) {
        unica.rejeitar(erro);
      }
      return;
    }
    await Promise.all(
      emBlocos(rodada, MAXIMO_DE_PASSOS_DO_LOTE).map((bloco) => this.executarBloco(bloco)),
    );
  }

  private async executarBloco(bloco: readonly LeituraPendente[]): Promise<void> {
    const passos: PassoDoLote[] = bloco.map((leitura, indice) => ({
      id: `leitura_${indice}`,
      operacao: OPERACAO_DE_LEITURA,
      payload: leitura.payload,
    }));
    try {
      const resultados = await executarLote(this.proxy, passos, this.operationIdDoLote);
      bloco.forEach((leitura, indice) => {
        const resultado = resultados[`leitura_${indice}`];
        if (resultado === undefined) {
          leitura.rejeitar(
            new ErroInterno(new Error(`O lote ${this.operationIdDoLote} não devolveu o passo.`)),
          );
        } else {
          leitura.resolver(resultado);
        }
      });
    } catch (erro) {
      bloco.forEach((leitura) => leitura.rejeitar(erro));
    }
  }
}
