import { randomUUID } from 'node:crypto';
import type { Executor } from '../banco/executor';

// Fila de escrita (docs/12, seção 12.5). As escritas passam uma a uma, em ordem de chegada (FIFO),
// e o chamador só recebe a resposta depois de gravada (operação síncrona). Cada item é registrado
// no repositório (tabela fila_escrita, padrão outbox) com o status pendente -> processando ->
// concluido | erro.

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
  atualizar(
    id: string,
    parcial: Partial<Pick<ItemFila, 'status' | 'tentativas' | 'erroMensagem'>>,
  ): Promise<void>;
}

export class RepositorioFilaMemoria implements RepositorioFila {
  readonly itens = new Map<string, ItemFila>();

  async registrar(item: ItemFila): Promise<void> {
    this.itens.set(item.id, { ...item });
  }
  async atualizar(id: string, parcial: Partial<ItemFila>): Promise<void> {
    const atual = this.itens.get(id);
    if (atual) Object.assign(atual, parcial, { atualizadoEm: new Date() });
  }
}

export interface MetaFila {
  sistemaOrigem: string;
  dominio: string;
  operacao: string;
  payload: unknown;
}

export class FilaEscrita {
  private cauda: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repositorio: RepositorioFila = new RepositorioFilaMemoria(),
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Entra no fim da fila e resolve com o resultado da tarefa (ou rejeita com o erro dela). */
  executar<T>(meta: MetaFila, tarefa: () => Promise<T>): Promise<T> {
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
    const resultado = this.cauda.then(async () => {
      await registrado;
      await this.repositorio.atualizar(item.id, { status: 'processando', tentativas: 1 });
      try {
        const valor = await tarefa();
        await this.repositorio.atualizar(item.id, { status: 'concluido' });
        return valor;
      } catch (e) {
        await this.repositorio
          .atualizar(item.id, {
            status: 'erro',
            erroMensagem: e instanceof Error ? e.message : String(e),
          })
          .catch(() => undefined);
        throw e;
      }
    });
    // A fila segue mesmo que esta tarefa falhe.
    this.cauda = resultado.catch(() => undefined);
    return resultado;
  }
}

/** Fila persistida na tabela fila_escrita (a ser criada pelo responsável pelo banco). */
export class RepositorioFilaPg implements RepositorioFila {
  constructor(private readonly banco: Executor) {}

  async registrar(i: ItemFila): Promise<void> {
    await this.banco.consultar({
      texto:
        'INSERT INTO fila_escrita (id, sistema_origem, dominio, operacao, payload, status, tentativas, criado_em, atualizado_em, erro_mensagem) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)',
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

  async atualizar(
    id: string,
    p: Partial<Pick<ItemFila, 'status' | 'tentativas' | 'erroMensagem'>>,
  ): Promise<void> {
    await this.banco.consultar({
      texto:
        'UPDATE fila_escrita SET status = COALESCE($2, status), tentativas = COALESCE($3, tentativas), erro_mensagem = COALESCE($4, erro_mensagem), atualizado_em = now() WHERE id = $1',
      valores: [id, p.status ?? null, p.tentativas ?? null, p.erroMensagem ?? null],
    });
  }
}
