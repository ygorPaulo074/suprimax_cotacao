// Item 2 do backend/TAREFAS.md — dublê do cliente do proxy para os testes dos módulos que leem e
// gravam dados. Substitui o ClienteProxy sem rede (comunicacao-backend-proxy.md, seção 7).
import type { ClienteDeProxy, RespostaDoProxy } from '../dados/proxyCliente';

/** Uma chamada recebida pelo dublê. */
export interface ChamadaAoProxy {
  readonly operacao: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly operationId: string;
}

/**
 * O que o dublê faz quando a operação é executada:
 * - um valor: é devolvido como resposta (já em camelCase, como o cliente real devolve);
 * - um `Error` (ErroProxy, AppError...): é lançado;
 * - uma função: recebe a chamada e devolve a resposta, ou lança.
 */
export type RespostaProgramada = unknown | Error | ((chamada: ChamadaAoProxy) => unknown);

/** O teste executou uma operação sem dizer ao dublê o que responder. */
export class OperacaoNaoProgramadaError extends Error {
  constructor(operacao: string) {
    super(`ProxyClienteFalso: nenhuma resposta programada para "${operacao}".`);
    this.name = 'OperacaoNaoProgramadaError';
  }
}

/**
 * Dublê em memória do cliente do proxy.
 *
 * @example
 * const proxy = new ProxyClienteFalso();
 * proxy.responder('dados.consultar', { ok: true, dados: [{ idCliente: 1 }], proximoCursor: null });
 * const repositorio = new RepositorioDeClientes(proxy);
 * // ... exercita o repositório ...
 * expect(proxy.chamadasDe('dados.consultar')[0]?.payload).toMatchObject({ tabela: 'cliente' });
 */
export class ProxyClienteFalso implements ClienteDeProxy {
  private readonly respostasFixas = new Map<string, RespostaProgramada>();
  private readonly respostasUnicas = new Map<string, RespostaProgramada[]>();
  private readonly chamadasRecebidas: ChamadaAoProxy[] = [];

  /** Todas as chamadas recebidas, na ordem. */
  get chamadas(): readonly ChamadaAoProxy[] {
    return this.chamadasRecebidas;
  }

  /** Chamadas recebidas de uma operação, na ordem. */
  chamadasDe(operacao: string): readonly ChamadaAoProxy[] {
    return this.chamadasRecebidas.filter((chamada) => chamada.operacao === operacao);
  }

  /** Define a resposta de toda execução da operação (substitui a anterior). */
  responder(operacao: string, resposta: RespostaProgramada): this {
    this.respostasFixas.set(operacao, resposta);
    return this;
  }

  /**
   * Enfileira uma resposta para uma única execução da operação. As respostas únicas são usadas na
   * ordem em que foram programadas e têm prioridade sobre a resposta fixa.
   */
  responderUmaVez(operacao: string, resposta: RespostaProgramada): this {
    const fila = this.respostasUnicas.get(operacao) ?? [];
    fila.push(resposta);
    this.respostasUnicas.set(operacao, fila);
    return this;
  }

  /** Esquece as respostas programadas e as chamadas recebidas. */
  limpar(): void {
    this.respostasFixas.clear();
    this.respostasUnicas.clear();
    this.chamadasRecebidas.length = 0;
  }

  async executar<T = RespostaDoProxy>(
    operacao: string,
    payload: Readonly<Record<string, unknown>>,
    operationId: string,
  ): Promise<T> {
    const chamada: ChamadaAoProxy = { operacao, payload, operationId };
    this.chamadasRecebidas.push(chamada);
    const resposta = this.proximaResposta(operacao);
    if (resposta instanceof Error) {
      throw resposta;
    }
    return (typeof resposta === 'function' ? await resposta(chamada) : resposta) as T;
  }

  private proximaResposta(operacao: string): RespostaProgramada {
    const fila = this.respostasUnicas.get(operacao);
    if (fila && fila.length > 0) {
      return fila.shift();
    }
    if (!this.respostasFixas.has(operacao)) {
      throw new OperacaoNaoProgramadaError(operacao);
    }
    return this.respostasFixas.get(operacao);
  }
}
