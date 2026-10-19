import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pino from 'pino';
import { Auditoria, RepositorioAuditoriaMemoria } from '../auditoria/auditoria';
import { CacheReplay } from '../auth/autenticacao';
import { RepositorioIntegrantesMemoria } from '../auth/integrantes';
import { ErroBanco, type Consulta, type Executor, type ResultadoConsulta } from '../banco/executor';
import { carregarConfig } from '../config';
import { esquemaDoDicionario } from '../esquema/esquema';
import { FilaEscrita } from '../fila/fila';
import { criarApp } from './app';
import type { DepsServidor } from './processar';

const ADMIN = 'chave-mestra-123456';
const env = { JWT_SIGNING_SECRET: 'j'.repeat(32), PROXY_ADMIN_KEY: ADMIN };

type Responder = (c: Consulta) => ResultadoConsulta | Error | undefined;

/** Banco de mentira: guarda as consultas e responde com o que o teste definir. */
class BancoFalso implements Executor {
  consultas: Consulta[] = [];
  transacoes = 0;
  responder: Responder = () => ({ linhas: [], contagem: 0 });

  async consultar(c: Consulta): Promise<ResultadoConsulta> {
    this.consultas.push(c);
    const r = this.responder(c) ?? { linhas: [], contagem: 0 };
    if (r instanceof Error) throw r;
    return r;
  }
  async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    this.transacoes++;
    return fn(this);
  }
}

let servidor: Server;
let base: string;
let banco: BancoFalso;
let auditoria: RepositorioAuditoriaMemoria;
let relogio = Date.now();

function iniciar(extra: Record<string, string> = {}) {
  banco = new BancoFalso();
  auditoria = new RepositorioAuditoriaMemoria();
  const logger = pino({ level: 'silent' });
  const config = carregarConfig({ ...env, ...extra });
  const deps: DepsServidor = {
    config,
    esquema: esquemaDoDicionario,
    banco,
    integrantes: new RepositorioIntegrantesMemoria(),
    fila: new FilaEscrita(),
    auditoria: new Auditoria(logger, auditoria),
    replay: new CacheReplay(120_000),
    logger,
    agora: () => new Date(),
  };
  servidor = criarApp(deps).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

beforeEach(() => iniciar());
afterEach(() => new Promise<void>((r) => servidor.close(() => r())));

interface Opcoes {
  token?: string;
  serviceId?: string;
  admin?: boolean;
  corpoBruto?: string;
}

/** Cada chamada usa um timestamp diferente, para não cair na proteção contra replay. */
async function chamar(operacao: string, payload: unknown, o: Opcoes = {}) {
  relogio += 1;
  const credencial = o.admin ? ADMIN : o.token;
  const res = await fetch(`${base}/executar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(credencial ? { authorization: `Bearer ${credencial}` } : {}),
      'x-timestamp': new Date(relogio).toISOString(),
      'x-service-id': o.serviceId ?? 'admin',
      'x-operation-id': 'teste',
    },
    body: o.corpoBruto ?? JSON.stringify({ operacao, payload }),
  });
  return { status: res.status, corpo: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function integrante(escopos: string[]) {
  const r = await chamar(
    'integrante.criar',
    { nome_sistema: 'Sistema 2', escopos },
    { admin: true },
  );
  expect(r.status).toBe(200);
  return { token: r.corpo.dados.token as string, serviceId: r.corpo.dados.service_id as string };
}
const como = (i: { token: string; serviceId: string }): Opcoes => ({
  token: i.token,
  serviceId: i.serviceId,
});

describe('transporte', () => {
  it('GET /saude', async () => {
    const res = await fetch(`${base}/saude`);
    expect(await res.json()).toEqual({ ok: true, ambiente: 'dev' });
  });

  it('rota inexistente e JSON malformado devolvem só códigos', async () => {
    expect((await fetch(`${base}/qualquer`)).status).toBe(404);
    const r = await chamar('x', {}, { admin: true, corpoBruto: '{nao é json' });
    expect(r.status).toBe(400);
    expect(r.corpo.erro.codigo).toBe('PAYLOAD_INVALIDO');
  });

  it('limita requisições (LIMITE_EXCEDIDO)', async () => {
    await new Promise<void>((r) => servidor.close(() => r()));
    iniciar({ RATE_LIMIT_MAXIMO: '3' });
    const status = [];
    for (let i = 0; i < 4; i++)
      status.push((await chamar('dados.consultar', { tabela: 'pedido' })).status);
    expect(status).toEqual([401, 401, 401, 429]);
  });
});

describe('autenticação', () => {
  it('sem credencial: TOKEN_INVALIDO (401)', async () => {
    const r = await chamar('dados.consultar', { tabela: 'pedido' });
    expect(r.status).toBe(401);
    expect(r.corpo).toMatchObject({ ok: false, erro: { codigo: 'TOKEN_INVALIDO' } });
  });

  it('integrante.criar exige a chave mestra e devolve o token uma única vez', async () => {
    const semChave = await chamar('integrante.criar', {
      nome_sistema: 'X',
      escopos: ['*:consultar'],
    });
    expect(semChave.status).toBe(401);
    const { token } = await integrante(['*:consultar']);
    expect(token.split('.')).toHaveLength(3);
  });

  it('o token de integrante não serve para a administração', async () => {
    const i = await integrante(['*:consultar']);
    const r = await chamar(
      'integrante.criar',
      { nome_sistema: 'Y', escopos: ['*:consultar'] },
      como(i),
    );
    expect(r.status).toBe(401);
  });

  it('rejeita escopo com formato inválido e revoga integrante', async () => {
    expect(
      (
        await chamar(
          'integrante.criar',
          { nome_sistema: 'Z', escopos: ['pedido:apagar'] },
          { admin: true },
        )
      ).status,
    ).toBe(400);

    const i = await integrante(['*:consultar']);
    expect((await chamar('dados.consultar', { tabela: 'pedido' }, como(i))).status).toBe(200);
    expect(
      (await chamar('integrante.revogar', { service_id: i.serviceId }, { admin: true })).status,
    ).toBe(200);
    expect((await chamar('dados.consultar', { tabela: 'pedido' }, como(i))).status).toBe(401);
    expect(
      (await chamar('integrante.revogar', { service_id: 'nao-existe' }, { admin: true })).status,
    ).toBe(404);
  });

  it('repetir a mesma requisição é bloqueado (replay)', async () => {
    const i = await integrante(['*:consultar']);
    const ts = new Date().toISOString();
    const enviar = () =>
      fetch(`${base}/executar`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${i.token}`,
          'x-timestamp': ts,
          'x-service-id': i.serviceId,
          'x-operation-id': 'op',
        },
        body: JSON.stringify({ operacao: 'dados.consultar', payload: { tabela: 'pedido' } }),
      });
    expect((await enviar()).status).toBe(200);
    expect((await enviar()).status).toBe(401);
  });
});

describe('dados.consultar', () => {
  it('devolve as linhas, o cursor da próxima página e usa só parâmetros', async () => {
    const i = await integrante(['pedido:consultar']);
    banco.responder = () => ({
      linhas: [{ id_pedido: 1 }, { id_pedido: 2 }, { id_pedido: 3 }],
      contagem: 3,
    });
    const r = await chamar('dados.consultar', { tabela: 'pedido', limite: 2 }, como(i));
    expect(r.status).toBe(200);
    expect(r.corpo.dados).toHaveLength(2);
    expect(r.corpo.proximo_cursor).toEqual(expect.any(String));
    const r2 = await chamar(
      'dados.consultar',
      { tabela: 'pedido', limite: 2, cursor: r.corpo.proximo_cursor },
      como(i),
    );
    expect(r2.status).toBe(200);
    expect(banco.consultas.at(-1)?.valores).toEqual([3, 2]);
  });

  it('sem o escopo da tabela (ou de uma tabela incluída): ESCOPO_NEGADO (403)', async () => {
    const i = await integrante(['pedido:consultar']);
    expect(
      (await chamar('dados.consultar', { tabela: 'cliente' }, como(i))).corpo.erro.codigo,
    ).toBe('ESCOPO_NEGADO');
    const incluir = await chamar(
      'dados.consultar',
      { tabela: 'pedido', incluir: ['item_pedido'] },
      como(i),
    );
    expect(incluir.status).toBe(403);
    expect(banco.consultas).toHaveLength(0);
  });

  it('tabela inexistente: PAYLOAD_INVALIDO, sem expor nada do banco', async () => {
    const i = await integrante(['*:consultar']);
    const r = await chamar('dados.consultar', { tabela: 'tabela_x' }, como(i));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.corpo)).not.toContain('tabela_x');
  });

  it('operador: colunas sensíveis só com o escopo das credenciais', async () => {
    const comum = await integrante(['*:consultar']);
    await chamar('dados.consultar', { tabela: 'operador' }, como(comum));
    expect(banco.consultas.at(-1)?.texto).not.toContain('senha_hash');
    expect(
      (await chamar('dados.consultar', { tabela: 'operador', campos: ['senha_hash'] }, como(comum)))
        .status,
    ).toBe(403);

    const auth = await integrante(['*:consultar', 'operador.credenciais:consultar']);
    await chamar('dados.consultar', { tabela: 'operador' }, como(auth));
    expect(banco.consultas.at(-1)?.texto).toContain('"senha_hash"');
  });

  it('operação desconhecida: 404', async () => {
    const i = await integrante(['*:consultar']);
    const r = await chamar('dados.apagar_tudo', {}, como(i));
    expect(r.status).toBe(404);
    expect(r.corpo.erro.codigo).toBe('OPERACAO_DESCONHECIDA');
  });
});

describe('verificação de risco estrutural', () => {
  const escopos = ['pedido:excluir', 'pedido:atualizar', 'pedido:inserir', 'pedido:consultar'];

  it('excluir sem filtro é bloqueado (422) e a auditoria registra o bloqueio', async () => {
    const i = await integrante(escopos);
    const r = await chamar('dados.excluir', { tabela: 'pedido' }, como(i));
    expect(r.status).toBe(422);
    expect(r.corpo.erro.codigo).toBe('RISCO_ESTRUTURAL');
    expect(auditoria.entradas.at(-1)).toMatchObject({
      operacao: 'dados.excluir',
      resultadoVerificacaoRisco: 'BLOQUEADO',
      statusExecucao: 'ERRO',
    });
    expect(banco.consultas.some((c) => c.texto.startsWith('DELETE'))).toBe(false);
  });

  it('afetaria mais de 50 linhas: bloqueado; até 50: executa', async () => {
    const i = await integrante(escopos);
    banco.responder = (c) =>
      c.texto.startsWith('SELECT COUNT') ? { linhas: [{ total: 51 }], contagem: 1 } : undefined;
    const filtros = { e: [['status', '=', 'CANCELADO']] };
    expect(
      (
        await chamar(
          'dados.atualizar',
          { tabela: 'pedido', filtros, valores: { status: 'NEGADO' } },
          como(i),
        )
      ).status,
    ).toBe(422);

    banco.responder = (c) =>
      c.texto.startsWith('SELECT COUNT')
        ? { linhas: [{ total: 3 }], contagem: 1 }
        : { linhas: [], contagem: 3 };
    const ok = await chamar('dados.excluir', { tabela: 'pedido', filtros }, como(i));
    expect(ok.corpo).toEqual({ ok: true, afetados: 3 });
    expect(auditoria.entradas.at(-1)?.resultadoVerificacaoRisco).toBe('APROVADO');
  });

  it('alterar a chave primária é bloqueado', async () => {
    const i = await integrante(escopos);
    banco.responder = () => ({ linhas: [{ total: 1 }], contagem: 1 });
    const r = await chamar(
      'dados.atualizar',
      { tabela: 'pedido', filtros: { e: [['id_pedido', '=', 1]] }, valores: { id_pedido: 9 } },
      como(i),
    );
    expect(r.corpo.erro.codigo).toBe('RISCO_ESTRUTURAL');
  });
});

describe('operações nomeadas', () => {
  it('pedido.assumir: sucesso, já assumido e inexistente', async () => {
    const i = await integrante(['operacao:pedido.assumir']);
    banco.responder = (c) =>
      c.texto.startsWith('UPDATE')
        ? { linhas: [{ id_pedido: 5, status: 'EM_ANALISE' }], contagem: 1 }
        : undefined;
    const ok = await chamar('pedido.assumir', { id_pedido: 5, id_operador: 2 }, como(i));
    expect(ok.corpo).toEqual({ ok: true, dados: { id_pedido: 5, status: 'EM_ANALISE' } });
    expect(banco.consultas.at(-1)?.valores).toEqual([5, 2]);

    banco.responder = (c) =>
      c.texto.startsWith('SELECT 1')
        ? { linhas: [{ '?column?': 1 }], contagem: 1 }
        : { linhas: [], contagem: 0 };
    const ja = await chamar('pedido.assumir', { id_pedido: 5, id_operador: 3 }, como(i));
    expect([ja.status, ja.corpo.erro.codigo]).toEqual([409, 'PEDIDO_JA_ASSUMIDO']);

    banco.responder = () => ({ linhas: [], contagem: 0 });
    expect(
      (await chamar('pedido.assumir', { id_pedido: 99, id_operador: 3 }, como(i))).status,
    ).toBe(404);
  });

  it('exige o escopo da operação e valida o payload', async () => {
    const i = await integrante(['pedido:atualizar']);
    expect((await chamar('pedido.assumir', { id_pedido: 5, id_operador: 2 }, como(i))).status).toBe(
      403,
    );
    const j = await integrante(['operacao:pedido.assumir']);
    expect(
      (await chamar('pedido.assumir', { id_pedido: 'x', id_operador: 2 }, como(j))).status,
    ).toBe(400);
  });

  it('orcamento.emitir traduz o erro de negócio da função do banco', async () => {
    const i = await integrante(['operacao:orcamento.emitir']);
    const chave = 'a'.repeat(32);
    banco.responder = () =>
      new ErroBanco('ESTOQUE_INSUFICIENTE:{"produto":"Arroz 5 kg","disponivel":2,"quantidade":5}');
    const r = await chamar(
      'orcamento.emitir',
      { id_orcamento: 7, id_operador: 2, chave_seguranca: chave },
      como(i),
    );
    expect(r.status).toBe(409);
    expect(r.corpo.erro).toMatchObject({
      codigo: 'ESTOQUE_INSUFICIENTE',
      detalhes: { produto: 'Arroz 5 kg', disponivel: 2, quantidade: 5 },
    });

    banco.responder = () => ({
      linhas: [{ id_orcamento: 7, numero_orcamento: 12, data_validade: '2026-11-18' }],
      contagem: 1,
    });
    const ok = await chamar(
      'orcamento.emitir',
      { id_orcamento: 7, id_operador: 2, chave_seguranca: chave },
      como(i),
    );
    expect(ok.corpo.dados).toMatchObject({ numero_orcamento: 12 });
    expect(banco.consultas.at(-1)?.texto).toContain('"proxy_orcamento_emitir"');
  });

  it('resposta.processar: RESPOSTA_JA_PROCESSADA e erro desconhecido do banco não vazam', async () => {
    const i = await integrante(['operacao:resposta.processar']);
    const corpo = {
      id_resposta: 3,
      resultado: {
        status_resposta: 'CONSOLIDADA',
        itens: [{ id_item_resposta: 1, situacao: 'APROVADO' }],
        status_orcamento: 'ACEITO',
      },
    };
    banco.responder = () => new ErroBanco('RESPOSTA_JA_PROCESSADA');
    expect((await chamar('resposta.processar', corpo, como(i))).status).toBe(409);

    banco.responder = () => new ErroBanco('relation "resposta_orcamento" does not exist');
    const r = await chamar('resposta.processar', corpo, como(i));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.corpo)).not.toContain('resposta_orcamento');
  });
});

describe('dados.lote e dados.rpc', () => {
  it('lote: transação única, passos encadeados por referência', async () => {
    const i = await integrante(['pedido:inserir', 'item_pedido:inserir']);
    banco.responder = (c) =>
      c.texto.startsWith('INSERT INTO "pedido"')
        ? { linhas: [{ id_pedido: 42 }], contagem: 1 }
        : { linhas: [{ id_item_pedido: 1 }], contagem: 1 };
    const r = await chamar(
      'dados.lote',
      {
        passos: [
          {
            id: 'p1',
            operacao: 'dados.inserir',
            payload: { tabela: 'pedido', valores: { id_cliente: 1, id_operador_vendedor: 2 } },
          },
          {
            id: 'p2',
            operacao: 'dados.inserir',
            payload: {
              tabela: 'item_pedido',
              valores: {
                id_pedido: '$p1.dados[0].id_pedido',
                id_variacao: 3,
                granularidade: 'AVULSO',
                quantidade_solicitada: 2,
              },
            },
          },
        ],
      },
      como(i),
    );
    expect(r.status).toBe(200);
    expect(Object.keys(r.corpo.resultados)).toEqual(['p1', 'p2']);
    expect(banco.transacoes).toBeGreaterThanOrEqual(1);
    expect(banco.consultas.at(-1)?.valores).toContain(42);
  });

  it('lote: falta de escopo em qualquer passo bloqueia tudo antes de executar', async () => {
    const i = await integrante(['pedido:inserir']);
    const r = await chamar(
      'dados.lote',
      {
        passos: [
          {
            id: 'p1',
            operacao: 'dados.inserir',
            payload: { tabela: 'pedido', valores: { id_cliente: 1 } },
          },
          {
            id: 'p2',
            operacao: 'dados.excluir',
            payload: { tabela: 'cliente', filtros: { e: [['id_cliente', '=', 1]] } },
          },
        ],
      },
      como(i),
    );
    expect(r.status).toBe(403);
    expect(banco.consultas).toHaveLength(0);
  });

  it('lote: recusa operação fora de dados.*, referência inválida e passos repetidos', async () => {
    const i = await integrante(['*:consultar', 'pedido:inserir', 'rpc:*']);
    const lote = (passos: unknown) => chamar('dados.lote', { passos }, como(i));
    expect(
      (await lote([{ id: 'a', operacao: 'dados.rpc', payload: { funcao: 'f' } }])).status,
    ).toBe(400);
    expect(
      (
        await lote([
          {
            id: 'a',
            operacao: 'dados.inserir',
            payload: { tabela: 'pedido', valores: { id_cliente: '$z.dados[0].x' } },
          },
        ])
      ).status,
    ).toBe(400);
    const repetido = { id: 'a', operacao: 'dados.consultar', payload: { tabela: 'pedido' } };
    expect((await lote([repetido, repetido])).status).toBe(400);
  });

  it('rpc: só funções autorizadas pelo escopo, com argumentos nomeados parametrizados', async () => {
    const i = await integrante(['rpc:minha_funcao']);
    banco.responder = () => ({ linhas: [{ minha_funcao: 7 }], contagem: 1 });
    const ok = await chamar(
      'dados.rpc',
      { funcao: 'minha_funcao', argumentos: { p_id: 5 } },
      como(i),
    );
    expect(ok.corpo).toEqual({ ok: true, resultado: [{ minha_funcao: 7 }] });
    expect(banco.consultas.at(-1)).toEqual({
      texto: 'SELECT * FROM "minha_funcao"("p_id" => $1)',
      valores: [5],
    });
    expect((await chamar('dados.rpc', { funcao: 'outra' }, como(i))).status).toBe(403);
    expect((await chamar('dados.rpc', { funcao: 'x"; DROP TABLE a; --' }, como(i))).status).toBe(
      400,
    );
  });
});

describe('auditoria e erros internos', () => {
  it('registra cada requisição com origem, operação e resultado, sem payload nem token', async () => {
    const i = await integrante(['*:consultar']);
    await chamar('dados.consultar', { tabela: 'pedido' }, como(i));
    await chamar(
      'dados.consultar',
      { tabela: 'cliente', filtros: { e: [['razao_social', '=', 'segredo-no-payload']] } },
      { token: 'lixo', serviceId: i.serviceId },
    );
    const [criar, ok, falha] = auditoria.entradas;
    expect(criar).toMatchObject({ operacao: 'integrante.criar', statusExecucao: 'SUCESSO' });
    expect(ok).toMatchObject({
      sistemaOrigem: i.serviceId,
      operacao: 'dados.consultar',
      resultado: 'ok',
      resultadoVerificacaoRisco: 'NAO_APLICAVEL',
    });
    expect(falha).toMatchObject({ statusExecucao: 'ERRO', resultado: 'TOKEN_INVALIDO' });
    const texto = JSON.stringify(auditoria.entradas);
    expect(texto).not.toContain(i.token);
    expect(texto).not.toContain('segredo-no-payload');
    expect(ok?.requestId).toEqual(expect.any(String));
    expect(ok?.duracaoMs).toBeGreaterThanOrEqual(0);
  });

  it('erro de integridade do banco vira 400 e erro inesperado vira 500, sem detalhes', async () => {
    const i = await integrante(['pedido:inserir']);
    banco.responder = () =>
      new ErroBanco('duplicate key value violates unique constraint "pedido_pkey"', '23505');
    const dup = await chamar(
      'dados.inserir',
      { tabela: 'pedido', valores: { id_cliente: 1 } },
      como(i),
    );
    expect(dup.status).toBe(400);
    expect(JSON.stringify(dup.corpo)).not.toContain('pkey');

    banco.responder = () => new Error('connection refused to db.internal:5432');
    const quebra = await chamar(
      'dados.inserir',
      { tabela: 'pedido', valores: { id_cliente: 1 } },
      como(i),
    );
    expect(quebra.status).toBe(500);
    expect(quebra.corpo.erro.codigo).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(quebra.corpo)).not.toContain('5432');
  });
});
