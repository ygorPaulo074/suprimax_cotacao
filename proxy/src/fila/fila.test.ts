import type { Consulta, Executor, ResultadoConsulta } from '../banco/executor';
import { FilaEscrita, ITEM_JA_TRATADO, RepositorioFilaMemoria } from './fila';

const meta = (operacao: string) => ({
  sistemaOrigem: 'sistema2',
  dominio: 'pedido',
  operacao,
  payload: { a: 1 },
});
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Banco que registra o que foi confirmado: só o que roda numa transação bem-sucedida conta. */
class BancoTransacional implements Executor {
  confirmadas: Consulta[] = [];
  private abertas: Consulta[] | null = null;
  async consultar(c: Consulta): Promise<ResultadoConsulta> {
    (this.abertas ?? this.confirmadas).push(c);
    return { linhas: [], contagem: 1 };
  }
  async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    this.abertas = [];
    try {
      const r = await fn(this);
      this.confirmadas.push(...this.abertas);
      return r;
    } finally {
      this.abertas = null;
    }
  }
}

describe('FilaEscrita', () => {
  it('executa as escritas uma a uma, na ordem de chegada', async () => {
    const fila = new FilaEscrita();
    const eventos: string[] = [];
    const tarefa = (nome: string, ms: number) => async () => {
      eventos.push(`inicio ${nome}`);
      await esperar(ms);
      eventos.push(`fim ${nome}`);
      return nome;
    };
    const resultados = await Promise.all([
      fila.executar(meta('dados.inserir'), tarefa('A', 30)),
      fila.executar(meta('dados.inserir'), tarefa('B', 5)),
      fila.executar(meta('dados.inserir'), tarefa('C', 1)),
    ]);
    expect(resultados).toEqual(['A', 'B', 'C']);
    expect(eventos).toEqual(['inicio A', 'fim A', 'inicio B', 'fim B', 'inicio C', 'fim C']);
  });

  it('registra o ciclo pendente -> processando -> concluido', async () => {
    const repo = new RepositorioFilaMemoria();
    const fila = new FilaEscrita(repo);
    await fila.executar(meta('dados.inserir'), async () => 'ok');
    const [item] = [...repo.itens.values()];
    expect(item).toMatchObject({
      status: 'concluido',
      tentativas: 1,
      sistemaOrigem: 'sistema2',
      operacao: 'dados.inserir',
    });
  });

  it('uma tarefa que falha vira erro, repassa a exceção e não trava a fila', async () => {
    const repo = new RepositorioFilaMemoria();
    const fila = new FilaEscrita(repo);
    const falha = fila.executar(meta('dados.atualizar'), async () => {
      throw new Error('boom');
    });
    const proxima = fila.executar(meta('dados.inserir'), async () => 'segue');
    await expect(falha).rejects.toThrow('boom');
    await expect(proxima).resolves.toBe('segue');
    const status = [...repo.itens.values()].map((i) => i.status);
    expect(status).toEqual(['erro', 'concluido']);
    expect([...repo.itens.values()][0]?.erroMensagem).toBe('boom');
  });

  it('a tarefa roda na transação aberta pela fila (escrita e conclusão confirmadas juntas)', async () => {
    const banco = new BancoTransacional();
    const fila = new FilaEscrita();
    await fila.executar(
      meta('dados.inserir'),
      (tx) => tx.consultar({ texto: 'INSERT 1', valores: [] }),
      banco,
    );
    await expect(
      fila.executar(
        meta('dados.inserir'),
        async (tx) => {
          await tx.consultar({ texto: 'INSERT 2', valores: [] });
          throw new Error('falhou depois de escrever');
        },
        banco,
      ),
    ).rejects.toThrow('falhou');
    // A escrita da tarefa que falhou foi desfeita com a transação.
    expect(banco.confirmadas.map((c) => c.texto)).toEqual(['INSERT 1']);
  });

  it('retomar não executa de novo um item já concluído (chave de idempotência = id do item)', async () => {
    const repo = new RepositorioFilaMemoria();
    const fila = new FilaEscrita(repo);
    await fila.executar(meta('dados.inserir'), async () => 'ok');
    const [item] = [...repo.itens.values()];
    const id = item?.id ?? '';
    const tarefa = jest.fn(async () => 'de novo');
    await expect(fila.retomar(id, tarefa)).rejects.toMatchObject({
      motivoInterno: ITEM_JA_TRATADO,
    });
    expect(tarefa).not.toHaveBeenCalled();
    expect(repo.itens.get(id)?.status).toBe('concluido');
  });

  it('não executa se outro processo concluiu o item entre o início e a trava', async () => {
    const repo = new RepositorioFilaMemoria();
    const fila = new FilaEscrita(repo);
    const id = 'outro';
    await repo.registrar({
      id,
      ...meta('dados.inserir'),
      status: 'processando',
      tentativas: 1,
      criadoEm: new Date(),
      atualizadoEm: new Date(),
      erroMensagem: null,
    });
    jest.spyOn(repo, 'travar').mockImplementationOnce(async () => {
      await repo.concluir(id); // a outra instância confirmou primeiro
      return false;
    });
    const tarefa = jest.fn(async () => 'x');
    await expect(fila.retomar(id, tarefa)).rejects.toMatchObject({
      motivoInterno: ITEM_JA_TRATADO,
    });
    expect(tarefa).not.toHaveBeenCalled();
    expect(repo.itens.get(id)).toMatchObject({ status: 'concluido', erroMensagem: null });
  });
});
