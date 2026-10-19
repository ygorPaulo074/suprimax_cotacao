import { Auditoria, RepositorioAuditoriaPg } from '../auditoria/auditoria';
import { RepositorioIntegrantesPg } from '../auth/integrantes';
import { RepositorioFilaPg } from '../fila/fila';
import type { Consulta, Executor, ResultadoConsulta } from './executor';
import { criarExecutorPg } from './pg';
import pino from 'pino';

class Gravador implements Executor {
  consultas: Consulta[] = [];
  resposta: ResultadoConsulta = { linhas: [], contagem: 0 };
  async consultar(c: Consulta) {
    this.consultas.push(c);
    return this.resposta;
  }
  async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('repositórios sobre o Postgres (SQL parametrizado)', () => {
  it('integrantes: busca, cria e revoga', async () => {
    const g = new Gravador();
    const repo = new RepositorioIntegrantesPg(g);
    g.resposta = {
      linhas: [
        {
          id: 'a',
          nome_sistema: 'S2',
          chave_hash: 'h',
          escopos: ['*:consultar'],
          ativo: true,
          criado_em: new Date(0),
          expira_em: null,
        },
      ],
      contagem: 1,
    };
    expect(await repo.buscarPorId('a')).toMatchObject({
      id: 'a',
      nomeSistema: 'S2',
      chaveHash: 'h',
      ativo: true,
    });
    g.resposta = { linhas: [], contagem: 0 };
    expect(await repo.buscarPorId('x')).toBeNull();

    await repo.criar({
      id: 'b',
      nomeSistema: 'S1',
      chaveHash: 'h2',
      escopos: [],
      ativo: true,
      criadoEm: new Date(0),
      expiraEm: null,
    });
    expect(g.consultas.at(-1)?.texto).toMatch(/^INSERT INTO integrantes_proxy/);
    expect(g.consultas.at(-1)?.valores).toHaveLength(7);

    g.resposta = { linhas: [], contagem: 1 };
    expect(await repo.revogar('b')).toBe(true);
    g.resposta = { linhas: [], contagem: 0 };
    expect(await repo.revogar('zz')).toBe(false);
  });

  it('fila: registra e atualiza o status', async () => {
    const g = new Gravador();
    const repo = new RepositorioFilaPg(g);
    const agora = new Date(0);
    await repo.registrar({
      id: '1',
      sistemaOrigem: 's',
      dominio: 'pedido',
      operacao: 'dados.inserir',
      payload: { a: 1 },
      status: 'pendente',
      tentativas: 0,
      criadoEm: agora,
      atualizadoEm: agora,
      erroMensagem: null,
    });
    expect(g.consultas[0]?.texto).toMatch(/^INSERT INTO fila_escrita/);
    expect(g.consultas[0]?.valores[4]).toBe('{"a":1}');
    await repo.atualizar('1', { status: 'concluido' });
    expect(g.consultas[1]).toMatchObject({ valores: ['1', 'concluido', null, null] });
  });

  it('auditoria: grava em log_auditoria e não derruba a requisição se falhar', async () => {
    const g = new Gravador();
    const entrada = {
      timestamp: new Date(0),
      sistemaOrigem: 's',
      operacao: 'dados.consultar',
      resultadoVerificacaoRisco: 'NAO_APLICAVEL' as const,
      statusExecucao: 'SUCESSO' as const,
      duracaoMs: 3,
      requestId: 'r',
      resultado: 'ok',
      idUsuario: null,
      ipOrigem: '1.1.1.1',
    };
    await new RepositorioAuditoriaPg(g).registrar(entrada);
    expect(g.consultas[0]?.texto).toMatch(/INSERT INTO log_auditoria/);

    const quebrado = { registrar: async () => Promise.reject(new Error('banco fora')) };
    await expect(
      new Auditoria(pino({ level: 'silent' }), quebrado).registrar(entrada),
    ).resolves.toBeUndefined();
  });

  it('o executor do Postgres é criado sem conectar', async () => {
    const e = criarExecutorPg('postgres://u:p@localhost:5432/x');
    await e.fechar();
  });
});
