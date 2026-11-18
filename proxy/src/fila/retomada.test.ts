import pino from 'pino';
import { Auditoria, RepositorioAuditoriaMemoria } from '../auditoria/auditoria';
import { CacheReplay } from '../auth/autenticacao';
import { RepositorioIntegrantesMemoria } from '../auth/integrantes';
import type { Consulta, Executor, ResultadoConsulta } from '../banco/executor';
import { carregarConfig } from '../config';
import { esquemaDoDicionario } from '../esquema/esquema';
import type { DepsServidor } from '../http/processar';
import { FilaEscrita, RepositorioFilaMemoria, type ItemFila } from './fila';
import { IDADE_MAXIMA_RETOMADA_MS, MAXIMO_TENTATIVAS_RETOMADA, retomarFila } from './retomada';

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

const inserts = (banco: BancoTransacional) =>
  banco.confirmadas.filter((c) => c.texto.startsWith('INSERT INTO "pedido"')).map((c) => c.valores);

describe('retomada da fila de escrita após reinício', () => {
  it('reexecuta pendentes e interrompidos em ordem, uma única vez, e audita', async () => {
    const { banco, repo, deps, auditoria } = await montar([
      // Interrompido no meio: a transação foi desfeita na queda, então não há efeito no banco.
      item('a', {
        status: 'processando',
        tentativas: 1,
        payload: inserirPedido(10),
        criadoEm: new Date(AGORA.getTime() - 90_000),
      }),
      item('b', { payload: inserirPedido(20) }),
      item('c', { status: 'concluido', tentativas: 1, payload: inserirPedido(30) }),
    ]);

    expect(await retomarFila(deps, repo)).toEqual({ retomados: 2, falharam: 0, descartados: 0 });
    expect(inserts(banco).map((v) => v[0])).toEqual([10, 20]);
    expect(repo.itens.get('a')).toMatchObject({ status: 'concluido', tentativas: 2 });
    expect(repo.itens.get('b')).toMatchObject({ status: 'concluido', tentativas: 1 });
    expect(repo.itens.get('c')).toMatchObject({ status: 'concluido', tentativas: 1 });
    expect(auditoria.entradas.map((e) => [e.requestId, e.operacao, e.statusExecucao])).toEqual([
      ['a', 'dados.inserir', 'SUCESSO'],
      ['b', 'dados.inserir', 'SUCESSO'],
    ]);

    // Um segundo reinício não repete nada: os itens já estão concluídos.
    expect(await retomarFila(deps, repo)).toEqual({ retomados: 0, falharam: 0, descartados: 0 });
    expect(inserts(banco)).toHaveLength(2);
  });

  it('descarta (status erro) o que não pode ou não deve ser repetido', async () => {
    const { banco, repo, deps, auditoria } = await montar([
      item('velho', { criadoEm: new Date(AGORA.getTime() - IDADE_MAXIMA_RETOMADA_MS - 1) }),
      item('esgotado', { status: 'processando', tentativas: MAXIMO_TENTATIVAS_RETOMADA }),
      item('sessao', { operacao: 'sessao.criar', dominio: 'sessao', payload: null }),
      item('desconhecida', { operacao: 'dados.apagar_tudo' }),
      item('sem-integrante', { sistemaOrigem: 'sistema-revogado' }),
    ]);

    expect(await retomarFila(deps, repo)).toEqual({ retomados: 0, falharam: 0, descartados: 5 });
    expect(inserts(banco)).toHaveLength(0);
    expect(auditoria.entradas).toHaveLength(0);
    const motivos = Object.fromEntries(
      [...repo.itens.values()].map((i) => [i.id, [i.status, i.erroMensagem]]),
    );
    expect(motivos).toEqual({
      velho: ['erro', 'não retomado após reinício: expirado'],
      esgotado: ['erro', 'não retomado após reinício: tentativas esgotadas'],
      sessao: ['erro', 'não retomado após reinício: operação sem payload na fila'],
      desconhecida: ['erro', 'não retomado após reinício: operação desconhecida'],
      'sem-integrante': ['erro', 'não retomado após reinício: integrante inválido'],
    });
  });

  it('payload que não passa mais na validação ou no escopo vira erro, sem tocar no banco', async () => {
    const { banco, repo, deps, auditoria } = await montar([
      item('invalido', { payload: { tabela: 'pedido' } }),
      item('sem-escopo', {
        operacao: 'dados.excluir',
        payload: { tabela: 'pedido', filtros: { e: [['id_pedido', '=', 1]] } },
      }),
      item('ok', { payload: inserirPedido(5) }),
    ]);

    expect(await retomarFila(deps, repo)).toEqual({ retomados: 1, falharam: 2, descartados: 0 });
    expect(inserts(banco).map((v) => v[0])).toEqual([5]);
    expect(repo.itens.get('invalido')?.status).toBe('erro');
    expect(repo.itens.get('sem-escopo')?.status).toBe('erro');
    expect(auditoria.entradas.map((e) => [e.requestId, e.resultado])).toEqual([
      ['invalido', 'PAYLOAD_INVALIDO'],
      ['sem-escopo', 'ESCOPO_NEGADO'],
      ['ok', 'ok'],
    ]);
  });

  it('falha ao listar a fila não derruba a subida do proxy', async () => {
    const { repo, deps } = await montar([]);
    jest.spyOn(repo, 'listarRetomaveis').mockRejectedValueOnce(new Error('banco fora'));
    await expect(retomarFila(deps, repo)).resolves.toEqual({
      retomados: 0,
      falharam: 0,
      descartados: 0,
    });
  });
});
