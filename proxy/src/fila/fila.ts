import { randomUUID } from 'node:crypto';
import type { Executor } from '../banco/executor';
import { AppError } from '../erros';

// Fila de escrita (docs/12, seção 12.5). As escritas passam uma a uma, em ordem de chegada (FIFO),
// e o chamador só recebe a resposta depois de gravada (operação síncrona). Cada item é registrado
// no repositório (tabela fila_escrita, padrão outbox) com o status pendente -> processando ->
// concluido | erro.
//
// Exatamente uma vez: a escrita e a marcação `concluido` acontecem na MESMA transação, que começa
// travando a linha do item (SELECT ... FOR UPDATE) e só segue se ele ainda estiver `processando`.
// Se o proxy cair no meio, a transação é desfeita e o item fica `processando` sem efeito no banco,
// e pode ser retomado no próximo início (retomada.ts). Se a transação foi confirmada, o item já está
// `concluido` e nunca é repetido. O id do item (chave primária de fila_escrita) é a chave de
// idempotência: duas instâncias que tentem o mesmo item se excluem pela trava da linha.

export type StatusFila = 'pendente' | 'processando' | 'concluido' | 'erro';

export interface ItemFila {
  id: string;
  sistemaOrigem: string;
  dominio: string;
  operacao: string;
  payload: unknown;
  status: StatusFila;
  tentativas: number;
  criadoEm: Date;
  atualizadoEm: Date;
  erroMensagem: string | null;
}

export interface RepositorioFila {
  registrar(item: ItemFila): Promise<void>;
  /**
   * Marca o item como `processando` e soma uma tentativa (fora da transação da escrita, para que a
   * contagem sobreviva a uma queda). Devolve as tentativas, ou null se o item já foi tratado.
   */
  iniciar(id: string): Promise<number | null>;
  /** Dentro da transação: trava a linha do item e diz se ele ainda está `processando`. */
  travar(id: string, tx: Executor): Promise<boolean>;
  /** Dentro da transação da escrita: marca `concluido`. */
  concluir(id: string, tx: Executor): Promise<void>;
  /** Marca `erro` com a mensagem (interna); nunca desfaz um `concluido`. */
  falhar(id: string, mensagem: string): Promise<void>;
  /** Itens `pendente` ou `processando`, em ordem de chegada, para a retomada após reinício. */
  listarRetomaveis(limite: number): Promise<ItemFila[]>;
}

export class RepositorioFilaMemoria implements RepositorioFila {
  readonly itens = new Map<string, ItemFila>();

  async registrar(item: ItemFila): Promise<void> {
    this.itens.set(item.id, { ...item });
  }
  async iniciar(id: string): Promise<number | null> {
    const atual = this.itens.get(id);
    if (!atual || (atual.status !== 'pendente' && atual.status !== 'processando')) return null;
    Object.assign(atual, {
      status: 'processando',
      tentativas: atual.tentativas + 1,
      atualizadoEm: new Date(),
    });
    return atual.tentativas;
  }
  async travar(id: string): Promise<boolean> {
    return this.itens.get(id)?.status === 'processando';
  }
  async concluir(id: string): Promise<void> {
    const atual = this.itens.get(id);
    if (atual) Object.assign(atual, { status: 'concluido', atualizadoEm: new Date() });
  }
  async falhar(id: string, mensagem: string): Promise<void> {
    const atual = this.itens.get(id);
    if (atual && atual.status !== 'concluido') {
      Object.assign(atual, { status: 'erro', erroMensagem: mensagem, atualizadoEm: new Date() });
    }
  }
  async listarRetomaveis(limite: number): Promise<ItemFila[]> {
    return [...this.itens.values()]
      .filter((i) => i.status === 'pendente' || i.status === 'processando')
      .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
      .slice(0, limite)
      .map((i) => ({ ...i }));
  }
}

export interface MetaFila {
  sistemaOrigem: string;
  dominio: string;
  operacao: string;
  payload: unknown;
}

/** A tarefa recebe o executor da transação da fila e deve fazer TODAS as escritas por ele. */
export type TarefaFila<T> = (tx: Executor) => Promise<T>;

/** Executor para quando a fila roda sem banco (testes): a transação só repassa, sem SQL. */
const SEM_BANCO: Executor = {
  consultar: () => Promise.reject(new Error('fila sem banco: SQL fora da transação da tarefa')),
  transacao: (fn) => fn(SEM_BANCO),
};

/** Motivo interno (só no log) quando outro processo já tratou o item. */
export const ITEM_JA_TRATADO = 'item da fila já tratado por outro processo';

function mensagemDoErro(e: unknown): string {
  if (e instanceof AppError) return e.motivoInterno ?? e.codigo;
  return e instanceof Error ? e.message : String(e);
}

export class FilaEscrita {
  private cauda: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repositorio: RepositorioFila = new RepositorioFilaMemoria(),
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /**
   * Registra um item novo, entra no fim da fila e resolve com o resultado da tarefa (ou rejeita com
   * o erro dela). `banco` abre a transação em que a tarefa e a marcação `concluido` rodam juntas.
   */
  executar<T>(meta: MetaFila, tarefa: TarefaFila<T>, banco: Executor = SEM_BANCO): Promise<T> {
    const item: ItemFila = {
      id: randomUUID(),
      ...meta,
      status: 'pendente',
      tentativas: 0,
      criadoEm: this.agora(),
      atualizadoEm: this.agora(),
      erroMensagem: null,
    };
    // O registro acontece na ordem de chegada; a execução, na ordem da fila.
    const registrado = this.repositorio.registrar(item);
    return this.enfileirar(async () => {
      await registrado;
      return this.processar(item.id, tarefa, banco);
    });
  }

  /** Retoma um item já registrado (após reinício), na mesma ordem e com as mesmas garantias. */
  retomar<T>(id: string, tarefa: TarefaFila<T>, banco: Executor = SEM_BANCO): Promise<T> {
    return this.enfileirar(() => this.processar(id, tarefa, banco));
  }

  private enfileirar<T>(passo: () => Promise<T>): Promise<T> {
    const resultado = this.cauda.then(passo);
    // A fila segue mesmo que esta tarefa falhe.
    this.cauda = resultado.catch(() => undefined);
    return resultado;
  }

  private async processar<T>(id: string, tarefa: TarefaFila<T>, banco: Executor): Promise<T> {
    if ((await this.repositorio.iniciar(id)) === null) {
      throw new AppError('INTERNAL_ERROR', undefined, ITEM_JA_TRATADO);
    }
    try {
      return await banco.transacao(async (tx) => {
        if (!(await this.repositorio.travar(id, tx))) {
          throw new AppError('INTERNAL_ERROR', undefined, ITEM_JA_TRATADO);
        }
        const valor = await tarefa(tx);
        await this.repositorio.concluir(id, tx);
        return valor;
      });
    } catch (e) {
      const mensagem = mensagemDoErro(e);
      if (mensagem !== ITEM_JA_TRATADO) {
        await this.repositorio.falhar(id, mensagem).catch(() => undefined);
      }
      throw e;
    }
  }
}

const COLUNAS =
  'id, sistema_origem, dominio, operacao, payload, status, tentativas, criado_em, atualizado_em, erro_mensagem';

function itemDaLinha(l: Record<string, unknown>): ItemFila {
  return {
    id: String(l.id),
    sistemaOrigem: String(l.sistema_origem),
    dominio: String(l.dominio),
    operacao: String(l.operacao),
    payload: l.payload ?? null,
    status: l.status as StatusFila,
    tentativas: Number(l.tentativas),
    criadoEm: new Date(l.criado_em as string | Date),
    atualizadoEm: new Date(l.atualizado_em as string | Date),
    erroMensagem: (l.erro_mensagem as string | null) ?? null,
  };
}

/** Fila persistida na tabela fila_escrita (migration 20261112000000_initial). */
export class RepositorioFilaPg implements RepositorioFila {
  constructor(private readonly banco: Executor) {}

  async registrar(i: ItemFila): Promise<void> {
    await this.banco.consultar({
      texto: `INSERT INTO fila_escrita (${COLUNAS}) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      valores: [
        i.id,
        i.sistemaOrigem,
        i.dominio,
        i.operacao,
        JSON.stringify(i.payload ?? null),
        i.status,
        i.tentativas,
        i.criadoEm,
        i.atualizadoEm,
        i.erroMensagem,
      ],
    });
  }

  async iniciar(id: string): Promise<number | null> {
    const r = await this.banco.consultar({
      texto:
        "UPDATE fila_escrita SET status = 'processando', tentativas = tentativas + 1, atualizado_em = now() WHERE id = $1 AND status IN ('pendente', 'processando') RETURNING tentativas",
      valores: [id],
    });
    const linha = r.linhas[0];
    return linha ? Number(linha.tentativas) : null;
  }

  async travar(id: string, tx: Executor): Promise<boolean> {
    const r = await tx.consultar({
      texto: 'SELECT status FROM fila_escrita WHERE id = $1 FOR UPDATE',
      valores: [id],
    });
    return r.linhas[0]?.status === 'processando';
  }

  async concluir(id: string, tx: Executor): Promise<void> {
    await tx.consultar({
      texto:
        "UPDATE fila_escrita SET status = 'concluido', atualizado_em = now() WHERE id = $1 AND status = 'processando'",
      valores: [id],
    });
  }

  async falhar(id: string, mensagem: string): Promise<void> {
    await this.banco.consultar({
      texto:
        "UPDATE fila_escrita SET status = 'erro', erro_mensagem = $2, atualizado_em = now() WHERE id = $1 AND status <> 'concluido'",
      valores: [id, mensagem],
    });
  }

  async listarRetomaveis(limite: number): Promise<ItemFila[]> {
    const r = await this.banco.consultar({
      texto: `SELECT ${COLUNAS} FROM fila_escrita WHERE status IN ('pendente', 'processando') ORDER BY criado_em, id LIMIT $1`,
      valores: [limite],
    });
    return r.linhas.map(itemDaLinha);
  }
}
