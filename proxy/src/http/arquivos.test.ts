import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pino from 'pino';
import { Armazenamento } from '../armazenamento/armazenamento';
import { Auditoria, RepositorioAuditoriaMemoria } from '../auditoria/auditoria';
import { CacheReplay } from '../auth/autenticacao';
import { RepositorioIntegrantesMemoria } from '../auth/integrantes';
import type { Consulta, Executor, ResultadoConsulta } from '../banco/executor';
import { carregarConfig } from '../config';
import { esquemaDoDicionario } from '../esquema/esquema';
import { FilaEscrita } from '../fila/fila';
import { criarApp } from './app';
import type { DepsServidor } from './processar';

const ADMIN = 'chave-mestra-123456';
const env = { JWT_SIGNING_SECRET: 'j'.repeat(32), PROXY_ADMIN_KEY: ADMIN };

class BancoFalso implements Executor {
  async consultar(c: Consulta): Promise<ResultadoConsulta> {
    void c;
    return { linhas: [], contagem: 0 };
  }
  async transacao<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

let servidor: Server;
let base: string;
let auditoria: RepositorioAuditoriaMemoria;
let relogio = Date.now();
const storage = jest.fn(async (url: string, init: RequestInit = {}) => {
  if ((init.method ?? 'GET') === 'GET') return new Response('{}', { status: 200 });
  if (url.includes('/object/sign/'))
    return new Response(JSON.stringify({ signedURL: '/object/sign/a/b?token=t' }), {
      status: 200,
    });
  return new Response('{}', { status: 200 });
});

beforeEach(() => {
  storage.mockClear();
  auditoria = new RepositorioAuditoriaMemoria();
  const logger = pino({ level: 'silent' });
  const deps: DepsServidor = {
    config: carregarConfig(env),
    esquema: esquemaDoDicionario,
    banco: new BancoFalso(),
    integrantes: new RepositorioIntegrantesMemoria(),
    fila: new FilaEscrita(),
    auditoria: new Auditoria(logger, auditoria),
    replay: new CacheReplay(120_000),
    logger,
    agora: () => new Date(),
    armazenamento: new Armazenamento(
      'https://x.supabase.co',
      'k',
      storage as unknown as typeof fetch,
    ),
  };
  servidor = criarApp(deps).listen(0);
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((r) => servidor.close(() => r())));

interface Cred {
  token?: string;
  serviceId?: string;
  admin?: boolean;
}

async function chamar(operacao: string, payload: unknown, cred: Cred) {
  relogio += 1;
  const res = await fetch(`${base}/executar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cred.admin ? ADMIN : cred.token}`,
      'x-timestamp': new Date(relogio).toISOString(),
      'x-service-id': cred.serviceId ?? 'admin',
      'x-operation-id': 'teste',
    },
    body: JSON.stringify({ operacao, payload }),
  });
  return { status: res.status, corpo: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function integrante(escopos: string[]) {
  const r = await chamar('integrante.criar', { nome_sistema: 'S2', escopos }, { admin: true });
  return { token: r.corpo.dados.token as string, serviceId: r.corpo.dados.service_id as string };
}

const ESCOPOS = ['operacao:arquivo.salvar', 'operacao:arquivo.remover', 'operacao:arquivo.assinar'];
const arq = (bytes: number) => ({
  id_orcamento: 3,
  nome_arquivo: 'a.pdf',
  tipo_conteudo: 'application/pdf',
  conteudo_base64: Buffer.alloc(bytes, 1).toString('base64'),
});

describe('arquivo.*', () => {
  it('salva, assina e remove com os escopos', async () => {
    const i = await integrante(ESCOPOS);
    const s = await chamar('arquivo.salvar', arq(100), i);
    expect(s.status).toBe(200);
    const caminho = s.corpo.dados.caminho as string;
    expect(caminho).toMatch(/^orcamento\/3\//);
    const a = await chamar('arquivo.assinar', { caminho, expira_em_segundos: 60 }, i);
    expect(a.corpo.dados.url).toContain('token=t');
    expect((await chamar('arquivo.remover', { caminho }, i)).corpo).toEqual({ ok: true });
  });

  it('nega sem o escopo e não toca no Storage', async () => {
    const i = await integrante(['operacao:arquivo.assinar']);
    const r = await chamar('arquivo.salvar', arq(10), i);
    expect(r.status).toBe(403);
    expect(r.corpo.erro.codigo).toBe('ESCOPO_NEGADO');
    expect(storage).not.toHaveBeenCalled();
  });

  it('rejeita caminho com .., fora de orcamento/ e expiração acima de 3600', async () => {
    const i = await integrante(ESCOPOS);
    for (const caminho of ['orcamento/../x', 'outro/1/a'])
      expect((await chamar('arquivo.remover', { caminho }, i)).corpo.erro.codigo).toBe(
        'PAYLOAD_INVALIDO',
      );
    const e = await chamar(
      'arquivo.assinar',
      { caminho: 'orcamento/1/a', expira_em_segundos: 3601 },
      i,
    );
    expect(e.corpo.erro.codigo).toBe('PAYLOAD_INVALIDO');
  });

  it('rejeita arquivo acima de 10 MB com PAYLOAD_INVALIDO', async () => {
    const i = await integrante(ESCOPOS);
    const r = await chamar('arquivo.salvar', arq(10 * 1024 * 1024 + 1), i);
    expect(r.status).toBe(400);
    expect(r.corpo.erro.codigo).toBe('PAYLOAD_INVALIDO');
  });

  it('aceita corpo grande só em arquivo.salvar; as demais ficam em 1 MB', async () => {
    const i = await integrante(ESCOPOS);
    expect((await chamar('arquivo.salvar', arq(9 * 1024 * 1024), i)).status).toBe(200);
    const grande = await chamar(
      'arquivo.assinar',
      { caminho: 'orcamento/1/a', lixo: 'x'.repeat(2_000_000) },
      i,
    );
    expect(grande.status).toBe(400);
    expect(grande.corpo.erro.codigo).toBe('PAYLOAD_INVALIDO');
  });

  it('não grava o conteúdo na auditoria', async () => {
    const i = await integrante(ESCOPOS);
    await chamar('arquivo.salvar', arq(50), i);
    expect(JSON.stringify(auditoria)).not.toContain(arq(50).conteudo_base64);
  });

  it('salva documento de crédito, assina e remove pelo prefixo analise-credito/', async () => {
    const i = await integrante(ESCOPOS);
    const { id_orcamento: _omitido, ...resto } = arq(100);
    void _omitido;
    const s = await chamar('arquivo.salvar', { ...resto, id_analise_credito: 9 }, i);
    expect(s.status).toBe(200);
    const caminho = s.corpo.dados.caminho as string;
    expect(caminho).toMatch(/^analise-credito\/9\//);
    expect(
      storage.mock.calls.some(([u]) => String(u).includes('/object/documentos-credito/')),
    ).toBe(true);
    const a = await chamar('arquivo.assinar', { caminho }, i);
    expect(a.status).toBe(200);
    expect((await chamar('arquivo.remover', { caminho }, i)).corpo).toEqual({ ok: true });
  });

  it('exige exatamente um de id_orcamento e id_analise_credito', async () => {
    const i = await integrante(ESCOPOS);
    const { id_orcamento: _omitido, ...resto } = arq(10);
    void _omitido;
    for (const payload of [resto, { ...arq(10), id_analise_credito: 1 }]) {
      const r = await chamar('arquivo.salvar', payload, i);
      expect(r.status).toBe(400);
      expect(r.corpo.erro.codigo).toBe('PAYLOAD_INVALIDO');
    }
  });

  it('rejeita caminhos de crédito com .. ou separador invertido', async () => {
    const i = await integrante(ESCOPOS);
    for (const caminho of [
      'analise-credito/../x',
      'analise-credito' + String.fromCharCode(92) + '1',
    ])
      expect((await chamar('arquivo.assinar', { caminho }, i)).corpo.erro.codigo).toBe(
        'PAYLOAD_INVALIDO',
      );
  });
});
