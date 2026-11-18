import type { Consulta, Executor, ResultadoConsulta } from '../banco/executor';
import { AppError } from '../erros';
import { esquemaDoDicionario } from '../esquema/esquema';
import { OPERACOES } from './registro';
import {
  OPERACOES_DE_SESSAO,
  sessaoBuscar,
  sessaoCriar,
  sessaoEncerrar,
  sessaoEncerrarOperador,
  sessaoRemoverExpiradas,
} from './sessoes';
import type { ContextoOperacao } from './tipos';

const HASH = 'ab'.repeat(32);

class BancoFalso implements Executor {
  consultas: Consulta[] = [];
  resposta: ResultadoConsulta = { linhas: [], contagem: 0 };
  async consultar(c: Consulta): Promise<ResultadoConsulta> {
    this.consultas.push(c);
    return this.resposta;
  }
  async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function contexto(banco: BancoFalso): ContextoOperacao {
  return {
    esquema: esquemaDoDicionario,
    banco,
    auth: { serviceId: 's2', escopos: [] } as unknown as ContextoOperacao['auth'],
    deps: {} as ContextoOperacao['deps'],
    credenciais: false,
    registrarRisco: () => undefined,
  };
}

function codigoDoErro(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof AppError ? e.codigo : 'outro';
  }
  return undefined;
}

describe('operações de sessão (UC13)', () => {
  let banco: BancoFalso;
  let ctx: ContextoOperacao;
  beforeEach(() => {
    banco = new BancoFalso();
    ctx = contexto(banco);
  });

  it('estão no catálogo, são escritas sigilosas e exigem operacao:<id>', () => {
    for (const op of OPERACOES_DE_SESSAO) {
      expect(OPERACOES.get(op.id)).toBe(op);
      expect(op.escrita).toBe(true);
      expect(op.sigilosa).toBe(true);
    }
    expect(sessaoEncerrarOperador.preparar({ id_operador: 1 }, ctx).escopos).toEqual([
      'operacao:sessao.encerrar_operador',
    ]);
  });

  it('a tabela sessao fica fora do dicionário: dados.* não a alcança', () => {
    expect(esquemaDoDicionario.tabelaExiste('sessao')).toBe(false);
  });

  it('criar grava hash, operador e prazo calculado pelo relógio do banco', async () => {
    banco.resposta = { linhas: [{ expira_em: '2026-11-18T12:30:00.000Z' }], contagem: 1 };
    const p = sessaoCriar.preparar(
      { token_hash: HASH, id_operador: 7, validade_segundos: 1800 },
      ctx,
    );
    expect(p.escopos).toEqual(['operacao:sessao.criar']);
    expect(await p.executar()).toEqual({ dados: { expira_em: '2026-11-18T12:30:00.000Z' } });
    const [c] = banco.consultas;
    expect(c?.texto).toContain('INSERT INTO "sessao"');
    expect(c?.texto).toContain('CURRENT_TIMESTAMP + make_interval(secs => $3)');
    expect(c?.valores).toEqual([HASH, 7, 1800]);
  });

  it('recusa hash fora do formato SHA-256, prazo fora dos limites e campos extras', () => {
    const invalidos = [
      { token_hash: 'token-em-texto-puro', id_operador: 1, validade_segundos: 1800 },
      { token_hash: HASH.toUpperCase(), id_operador: 1, validade_segundos: 1800 },
      { token_hash: HASH, id_operador: 1, validade_segundos: 59 },
      { token_hash: HASH, id_operador: 1, validade_segundos: 86_401 },
      { token_hash: HASH, id_operador: 0, validade_segundos: 1800 },
      { token_hash: HASH, id_operador: 1, validade_segundos: 1800, perfil: 'ADMIN' },
    ];
    for (const payload of invalidos) {
      expect(codigoDoErro(() => sessaoCriar.preparar(payload, ctx))).toBe('PAYLOAD_INVALIDO');
    }
    expect(codigoDoErro(() => sessaoRemoverExpiradas.preparar({ x: 1 }, ctx))).toBe(
      'PAYLOAD_INVALIDO',
    );
  });

  it('buscar sem renovar é só leitura e ignora sessão vencida', async () => {
    const linha = { id_operador: 7, usuario: 'ana', email: 'a@x', perfil: 'OPERADOR' };
    banco.resposta = { linhas: [linha], contagem: 1 };
    const p = sessaoBuscar.preparar({ token_hash: HASH }, ctx);
    expect(p.somenteLeitura).toBe(true);
    expect(await p.executar()).toEqual({ dados: linha });
    const [c] = banco.consultas;
    expect(c?.texto.startsWith('SELECT')).toBe(true);
    expect(c?.texto).toContain('"expira_em" > CURRENT_TIMESTAMP');
    expect(c?.texto).toContain('JOIN "operador"');
    expect(c?.valores).toEqual([HASH]);
  });

  it('buscar com renovar atualiza o prazo (sem encurtar) na mesma instrução e passa pela fila', async () => {
    const p = sessaoBuscar.preparar({ token_hash: HASH, renovar_segundos: 1800 }, ctx);
    expect(p.somenteLeitura).toBe(false);
    expect(await p.executar()).toEqual({ dados: null });
    const [c] = banco.consultas;
    expect(c?.texto).toContain('UPDATE "sessao" SET "expira_em" = GREATEST("expira_em"');
    expect(c?.texto).toContain('WHERE "token_hash" = $1 AND "expira_em" > CURRENT_TIMESTAMP');
    expect(c?.valores).toEqual([HASH, 1800]);
  });

  it('encerrar, encerrar_operador e remover_expiradas apagam e devolvem quantas', async () => {
    banco.resposta = { linhas: [], contagem: 2 };
    expect(await sessaoEncerrar.preparar({ token_hash: HASH }, ctx).executar()).toEqual({
      afetados: 2,
    });
    expect(await sessaoEncerrarOperador.preparar({ id_operador: 7 }, ctx).executar()).toEqual({
      afetados: 2,
    });
    expect(await sessaoRemoverExpiradas.preparar({}, ctx).executar()).toEqual({ afetados: 2 });
    expect(banco.consultas.map((c) => [c.texto, c.valores])).toEqual([
      ['DELETE FROM "sessao" WHERE "token_hash" = $1', [HASH]],
      ['DELETE FROM "sessao" WHERE "id_operador" = $1', [7]],
      ['DELETE FROM "sessao" WHERE "expira_em" <= CURRENT_TIMESTAMP', []],
    ]);
  });
});
