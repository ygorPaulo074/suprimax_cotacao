import request from 'supertest';
import { ErroDeServicoIndisponivel } from '../erros';
import { RepositorioDeSessoesEmMemoria } from '../modulos/auth/sessoes';
import { montarAppDeTeste } from '../testing/appDeTeste';
import { createApp } from './app';
import { ProxyClienteFalso } from '../testing/proxyClienteFalso';
import {
  criarVerificadorDeSaude,
  NOMES_DAS_VERIFICACOES,
  TEMPO_LIMITE_DA_GRAVACAO_MS,
  type DependenciasDoVerificador,
} from './saudeCompleta';

const OPERADOR = {
  idOperador: 7,
  usuario: 'davi',
  email: 'davi@suprimax.test',
  perfil: 'OPERADOR',
};

const respostaDoProxy = (status = 200) => Promise.resolve(new Response('{"ok":true}', { status }));

function montar(extras: Partial<DependenciasDoVerificador> = {}) {
  const proxy = new ProxyClienteFalso()
    .responder('dados.consultar', { ok: true, dados: [OPERADOR] })
    .responder('dados.atualizar', { ok: true, afetados: 0 });
  const sessoes = new RepositorioDeSessoesEmMemoria({ inatividadeMs: 60_000 });
  const chamadasAoProxy: { url: string; init?: RequestInit }[] = [];
  const fetchDoProxy = (url: string | URL | Request, init?: RequestInit) => {
    chamadasAoProxy.push({ url: String(url), init });
    return respostaDoProxy();
  };
  let relogio = 1_000_000;
  const verificar = criarVerificadorDeSaude({
    proxyUrl: 'https://proxy.exemplo.test',
    proxy,
    sessoes,
    fetch: fetchDoProxy as typeof fetch,
    agora: () => (relogio += 5),
    validadeMs: 0,
    ...extras,
  });
  return { verificar, proxy, sessoes, chamadasAoProxy };
}

const porNome = (
  r: Awaited<ReturnType<ReturnType<typeof criarVerificadorDeSaude>>>,
  nome: string,
) => r.verificacoes.find((v) => v.nome === nome);

describe('criarVerificadorDeSaude', () => {
  it('com tudo funcionando, todas as etapas passam e ok é verdadeiro', async () => {
    const { verificar, chamadasAoProxy } = montar();

    const resposta = await verificar();

    expect(resposta.ok).toBe(true);
    expect(resposta.verificacoes.map((v) => v.nome)).toEqual([...NOMES_DAS_VERIFICACOES]);
    expect(resposta.verificacoes.every((v) => v.ok && v.erro === undefined)).toBe(true);
    expect(chamadasAoProxy).toHaveLength(1);
    expect(chamadasAoProxy[0]?.url).toBe('https://proxy.exemplo.test/saude');
    expect(chamadasAoProxy[0]?.init?.method).toBe('GET');
  });

  it('a gravação de teste não altera linha: filtra um id que não existe e usa o prazo maior', async () => {
    const { verificar, proxy } = montar();

    await verificar();

    const [gravacao] = proxy.chamadasDe('dados.atualizar');
    expect(gravacao?.payload).toMatchObject({
      tabela: 'operador',
      filtros: { e: [['id_operador', '=', 0]] },
    });
    expect(gravacao?.opcoes).toEqual({ tempoLimiteMs: TEMPO_LIMITE_DA_GRAVACAO_MS });
  });

  it('abre e encerra a sessão de teste, sem deixar sessão aberta', async () => {
    const { verificar, sessoes } = montar();

    await verificar();

    expect(sessoes.quantidade).toBe(0);
  });

  it('proxy que não responde: falha nele e pula as etapas que dependem dele, sem consultar o banco', async () => {
    const { verificar, proxy } = montar({
      fetch: (() => Promise.reject(new Error('fora do ar'))) as unknown as typeof fetch,
    });

    const resposta = await verificar();

    expect(resposta.ok).toBe(false);
    expect(porNome(resposta, 'backend')?.ok).toBe(true);
    expect(porNome(resposta, 'proxy')).toMatchObject({ ok: false, erro: 'ERRO' });
    for (const nome of ['banco_leitura', 'banco_gravacao', 'sessoes']) {
      expect(porNome(resposta, nome)).toMatchObject({ ok: false, erro: 'PROXY_INDISPONIVEL' });
    }
    expect(proxy.chamadas).toHaveLength(0);
  });

  it('proxy que responde com erro HTTP conta como indisponível', async () => {
    const { verificar } = montar({
      fetch: (() => respostaDoProxy(503)) as unknown as typeof fetch,
    });

    const resposta = await verificar();

    expect(porNome(resposta, 'proxy')).toMatchObject({ ok: false, erro: 'PROXY_INDISPONIVEL' });
  });

  it('sem PROXY_URL configurada, a etapa do proxy falha com PROXY_NAO_CONFIGURADO', async () => {
    const { verificar } = montar({ proxyUrl: undefined });

    const resposta = await verificar();

    expect(porNome(resposta, 'proxy')).toMatchObject({ ok: false, erro: 'PROXY_NAO_CONFIGURADO' });
  });

  it('só a gravação falhando: leitura passa, gravação falha com o código do erro, e o login (sessão) segue testado', async () => {
    const { verificar, proxy } = montar();
    proxy.responder('dados.atualizar', new ErroDeServicoIndisponivel());

    const resposta = await verificar();

    expect(resposta.ok).toBe(false);
    expect(porNome(resposta, 'banco_leitura')?.ok).toBe(true);
    expect(porNome(resposta, 'banco_gravacao')).toMatchObject({
      ok: false,
      erro: 'SERVICO_INDISPONIVEL',
    });
    expect(porNome(resposta, 'sessoes')?.ok).toBe(true);
  });

  it('leitura falhando: a sessão não é testada, porque falta o operador', async () => {
    const { verificar, proxy } = montar();
    proxy.responder('dados.consultar', new ErroDeServicoIndisponivel());

    const resposta = await verificar();

    expect(porNome(resposta, 'banco_leitura')).toMatchObject({ ok: false });
    expect(porNome(resposta, 'sessoes')).toMatchObject({ ok: false, erro: 'SEM_LEITURA' });
  });

  it('banco sem nenhum usuário: a sessão não pode ser testada e a verificação não passa', async () => {
    const { verificar, proxy } = montar();
    proxy.responder('dados.consultar', { ok: true, dados: [] });

    const resposta = await verificar();

    expect(resposta.ok).toBe(false);
    expect(porNome(resposta, 'sessoes')).toMatchObject({ ok: false, erro: 'SEM_USUARIOS' });
  });

  it('falha ao criar a sessão aparece na etapa de sessões', async () => {
    const { verificar, sessoes } = montar();
    jest.spyOn(sessoes, 'criar').mockRejectedValue(new ErroDeServicoIndisponivel());

    const resposta = await verificar();

    expect(porNome(resposta, 'sessoes')).toMatchObject({
      ok: false,
      erro: 'SERVICO_INDISPONIVEL',
    });
  });

  it('a resposta só leva códigos curtos: nunca a mensagem, o endereço do proxy nem dados do operador', async () => {
    const { verificar, proxy } = montar();
    proxy.responder('dados.atualizar', new Error('senha=segredo host=db.interno'));

    const texto = JSON.stringify(await verificar());

    expect(texto).not.toContain('segredo');
    expect(texto).not.toContain('db.interno');
    expect(texto).not.toContain('proxy.exemplo.test');
    expect(texto).not.toContain('davi');
    expect(texto).not.toContain('suprimax.test');
  });

  it('chamadas simultâneas dividem a mesma verificação', async () => {
    const { verificar, proxy } = montar();

    await Promise.all([verificar(), verificar(), verificar()]);

    expect(proxy.chamadasDe('dados.consultar')).toHaveLength(1);
  });

  it('dentro do prazo de validade reaproveita o resultado; depois dele, verifica de novo', async () => {
    let agora = 0;
    const { verificar, proxy } = montar({ agora: () => agora, validadeMs: 3_000 });

    await verificar();
    agora = 2_000;
    await verificar();
    expect(proxy.chamadasDe('dados.consultar')).toHaveLength(1);

    agora = 3_500;
    await verificar();
    expect(proxy.chamadasDe('dados.consultar')).toHaveLength(2);
  });
});

describe('GET /saude/completa', () => {
  it('é pública e responde 200 com ok falso e o resultado de cada etapa quando algo falha', async () => {
    // O app de teste não tem PROXY_URL: a etapa do proxy falha e o resto é pulado.
    const resposta = await request(montarAppDeTeste().app).get('/saude/completa');

    expect(resposta.status).toBe(200);
    expect(resposta.body.ok).toBe(false);
    expect(resposta.body.verificacoes.map((v: { nome: string }) => v.nome)).toEqual([
      ...NOMES_DAS_VERIFICACOES,
    ]);
    expect(typeof resposta.body.verificadoEm).toBe('string');
  });

  it('com um verificador que passa, responde ok verdadeiro', async () => {
    const verificadorDeSaude = jest.fn().mockResolvedValue({
      ok: true,
      verificacoes: [],
      verificadoEm: '2026-11-24T22:00:00.000Z',
    });
    const { dependencias } = montarAppDeTeste();

    const resposta = await request(createApp({ ...dependencias, verificadorDeSaude })).get(
      '/saude/completa',
    );

    expect(resposta.status).toBe(200);
    expect(resposta.body.ok).toBe(true);
  });

  it('erro inesperado do verificador segue para o tratamento padrão de erros', async () => {
    const verificadorDeSaude = jest.fn().mockRejectedValue(new Error('falha'));
    const { dependencias } = montarAppDeTeste();

    const resposta = await request(createApp({ ...dependencias, verificadorDeSaude })).get(
      '/saude/completa',
    );

    expect(resposta.status).toBe(500);
  });

  it('não altera GET /saude, que continua só dizendo que o processo está de pé', async () => {
    const resposta = await request(montarAppDeTeste().app).get('/saude');

    expect(resposta.body).toEqual({ status: 'ok' });
  });
});
