import { FilaEscrita, RepositorioFilaMemoria } from './fila';

const meta = (operacao: string) => ({
  sistemaOrigem: 'sistema2',
  dominio: 'pedido',
  operacao,
  payload: { a: 1 },
});
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
});
