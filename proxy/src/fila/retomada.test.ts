import pino from 'pino';
import { Auditoria, RepositorioAuditoriaMemoria } from '../auditoria/auditoria';
import { CacheReplay } from '../auth/autenticacao';
import { RepositorioIntegrantesMemoria } from '../auth/integrantes';
import type { Consulta, Executor, ResultadoConsulta } from '../banco/executor';
import { carregarConfig } from '../config';
import { esquemaDoDicionario } from '../esquema/esquema';
import type { DepsServidor } from '../http/processar';
import { FilaEscrita, RepositorioFilaMemoria, type ItemFila } from './fila';
import { MOTIVO_INTERRUPCAO, RESULTADO_INTERRUPCAO, retomarFila } from './retomada';

/** Banco que só conta como gravado o que a transação confirmou (simula a queda desfazendo). */
class BancoTransacional implements Executor {
  confirmadas: Consulta[] = [];
  private abertas: Consulta[] | null = null;
  async consultar(c: Consulta): Promise<ResultadoConsulta> {
    (this.abertas ?? this.confirmadas).push(c);
    return { linhas: [{ id_pedido: 1 }], contagem: 1 };
  }
  async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    if (this.abertas) return fn(this); // aninhada: mesma transação
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

const AGORA = new Date('2026-11-18T12:00:00.000Z');
const inserirPedido = (id_cliente: number) => ({
  tabela: 'pedido',
  valores: { id_cliente, id_operador_vendedor: 2 },
});

function item(id: string, parcial: Partial<ItemFila> = {}): ItemFila {
  return {
    id,
    sistemaOrigem: 'sistema2',
    dominio: 'pedido',
    operacao: 'dados.inserir',
    payload: inserirPedido(1),
    status: 'pendente',
    tentativas: 0,
    criadoEm: new Date(AGORA.getTime() - 60_000),
    atualizadoEm: new Date(AGORA.getTime() - 60_000),
    erroMensagem: null,
    ...parcial,
  };
}

async function montar(itens: ItemFila[]) {
  const banco = new BancoTransacional();
  const repo = new RepositorioFilaMemoria();
  for (const i of itens) await repo.registrar(i);
  const integrantes = new RepositorioIntegrantesMemoria();
  await integrantes.criar({
    id: 'sistema2',
    nomeSistema: 'Sistema 2',
    chaveHash: 'h',
    escopos: ['*:inserir', 'operacao:sessao.criar'],
    ativo: true,
    criadoEm: new Date(0),
    expiraEm: null,
  });
  const auditoria = new RepositorioAuditoriaMemoria();
  const logger = pino({ level: 'silent' });
  // Processo novo, como depois de um reinício: fila vazia em memória, itens só no repositório.
  const deps: DepsServidor = {
    config: carregarConfig({ JWT_SIGNING_SECRET: 'j'.repeat(32), PROXY_ADMIN_KEY: 'k'.repeat(20) }),
    esquema: esquemaDoDicionario,
    banco,
    integrantes,
    fila: new FilaEscrita(repo, () => AGORA),
    auditoria: new Auditoria(logger, auditoria),
    replay: new CacheReplay(1000),
    logger,
    agora: () => AGORA,
  };
  return { banco, repo, deps, auditoria };
}

describe('tratamento da fila de escrita após reinício (sem reexecução)', () => {
  it('marca erro os pendentes e interrompidos, sem executar nada, e audita cada um em ordem', async () => {
    const { banco, repo, deps, auditoria } = await montar([
      // Interrompido no meio: a transação foi desfeita na queda, então não há efeito no banco.
      item('a', {
        status: 'processando',
        tentativas: 1,
        criadoEm: new Date(AGORA.getTime() - 90_000),
      }),
      item('b'),
      item('c', { status: 'concluido', tentativas: 1 }),
      item('d', { status: 'erro', erroMensagem: 'motivo antigo' }),
      item('velho', { criadoEm: new Date(AGORA.getTime() - 3_600_000) }),
      item('sessao', { operacao: 'sessao.criar', dominio: 'sessao', payload: null }),
    ]);

    expect(await retomarFila(deps, repo, AGORA)).toEqual({ interrompidos: 4 });
    expect(banco.confirmadas).toHaveLength(0); // nenhuma escrita foi reexecutada
    expect(
      Object.fromEntries([...repo.itens.values()].map((i) => [i.id, [i.status, i.erroMensagem]])),
    ).toEqual({
      a: ['erro', MOTIVO_INTERRUPCAO],
      b: ['erro', MOTIVO_INTERRUPCAO],
      c: ['concluido', null],
      d: ['erro', 'motivo antigo'],
      velho: ['erro', MOTIVO_INTERRUPCAO],
      sessao: ['erro', MOTIVO_INTERRUPCAO],
    });
    expect(repo.itens.get('a')?.tentativas).toBe(1);
    expect(
      auditoria.entradas.map((e) => [e.requestId, e.statusExecucao, e.resultado, e.idUsuario]),
    ).toEqual(['velho', 'a', 'b', 'sessao'].map((id) => [id, 'ERRO', RESULTADO_INTERRUPCAO, null]));

    // Um segundo reinício não encontra mais nada.
    expect(await retomarFila(deps, repo, AGORA)).toEqual({ interrompidos: 0 });
    expect(banco.confirmadas).toHaveLength(0);
  });

  it('não toca nos itens criados depois do início do processo (escritas novas não furam a ordem)', async () => {
    const { repo, deps } = await montar([
      item('antigo'),
      item('novo', { criadoEm: new Date(AGORA.getTime() + 1) }),
    ]);
    expect(await retomarFila(deps, repo, AGORA)).toEqual({ interrompidos: 1 });
    expect(repo.itens.get('antigo')?.status).toBe('erro');
    expect(repo.itens.get('novo')?.status).toBe('pendente');
  });

  it('falha ao marcar a fila não derruba a subida do proxy', async () => {
    const { repo, deps } = await montar([]);
    jest.spyOn(repo, 'interromper').mockRejectedValueOnce(new Error('banco fora'));
    await expect(retomarFila(deps, repo, AGORA)).resolves.toEqual({ interrompidos: 0 });
  });
});
