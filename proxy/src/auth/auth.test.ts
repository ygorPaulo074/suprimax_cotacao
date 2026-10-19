import { AppError } from '../erros';
import {
  autenticarAdmin,
  autenticarIntegrante,
  CacheReplay,
  type DepsAutenticacao,
} from './autenticacao';
import { exigirEscopos, possuiEscopo, validarEscopos } from './escopos';
import { RepositorioIntegrantesMemoria } from './integrantes';
import { emitirToken, hashToken, verificarToken } from './token';

const SEGREDO = 's'.repeat(32);
const AGORA = new Date('2026-10-19T12:00:00Z');

async function montar(opcoes: { ativo?: boolean; expiraEm?: Date | null } = {}) {
  const integrantes = new RepositorioIntegrantesMemoria();
  const token = emitirToken(SEGREDO, {
    serviceId: 'sistema2',
    escopos: ['*:consultar'],
    expiraEm: new Date('2027-01-01T00:00:00Z'),
  });
  await integrantes.criar({
    id: 'sistema2',
    nomeSistema: 'Sistema 2',
    chaveHash: hashToken(token),
    escopos: ['*:consultar', 'pedido:inserir'],
    ativo: opcoes.ativo ?? true,
    criadoEm: AGORA,
    expiraEm: opcoes.expiraEm ?? null,
  });
  const deps: DepsAutenticacao = {
    segredoJwt: SEGREDO,
    chaveAdmin: 'chave-mestra-123456',
    toleranciaSegundos: 60,
    integrantes,
    replay: new CacheReplay(120_000),
    agora: () => AGORA,
  };
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    'x-timestamp': AGORA.toISOString(),
    'x-service-id': 'sistema2',
    'x-operation-id': 'op-1',
    ...extra,
  });
  return { deps, token, headers };
}

async function codigo(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e instanceof AppError ? e.codigo : 'OUTRO';
  }
  return 'OK';
}

describe('token do integrante', () => {
  it('emite e verifica, e o hash é estável', () => {
    const t = emitirToken(SEGREDO, {
      serviceId: 'a',
      escopos: ['pedido:consultar'],
      expiraEm: new Date('2030-01-01'),
    });
    expect(verificarToken(SEGREDO, t)).toMatchObject({
      service_id: 'a',
      escopos: ['pedido:consultar'],
    });
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toHaveLength(64);
  });

  it('rejeita assinatura errada, token expirado e lixo', async () => {
    const t = emitirToken(SEGREDO, {
      serviceId: 'a',
      escopos: [],
      expiraEm: new Date('2030-01-01'),
    });
    const expirado = emitirToken(SEGREDO, {
      serviceId: 'a',
      escopos: [],
      expiraEm: new Date('2020-01-01'),
    });
    expect(await codigo(() => verificarToken('outro-segredo-com-32-caracteres!!', t))).toBe(
      'TOKEN_INVALIDO',
    );
    expect(await codigo(() => verificarToken(SEGREDO, expirado))).toBe('TOKEN_INVALIDO');
    expect(await codigo(() => verificarToken(SEGREDO, 'nao-e-jwt'))).toBe('TOKEN_INVALIDO');
  });
});

describe('escopos', () => {
  it('correspondência exata e curinga de tabela', () => {
    expect(possuiEscopo(['pedido:inserir'], 'pedido:inserir')).toBe(true);
    expect(possuiEscopo(['pedido:inserir'], 'pedido:excluir')).toBe(false);
    expect(possuiEscopo(['*:consultar'], 'cliente:consultar')).toBe(true);
    expect(possuiEscopo(['*:consultar'], 'cliente:inserir')).toBe(false);
  });

  it('o curinga não cobre as credenciais do operador', () => {
    expect(possuiEscopo(['*:consultar'], 'operador.credenciais:consultar')).toBe(false);
    expect(
      possuiEscopo(
        ['*:consultar', 'operador.credenciais:consultar'],
        'operador.credenciais:consultar',
      ),
    ).toBe(true);
  });

  it('rpc e operação nomeada', () => {
    expect(possuiEscopo(['rpc:*'], 'rpc:minha_funcao')).toBe(true);
    expect(possuiEscopo(['rpc:outra'], 'rpc:minha_funcao')).toBe(false);
    expect(possuiEscopo(['operacao:pedido.assumir'], 'operacao:pedido.assumir')).toBe(true);
    expect(possuiEscopo(['*:consultar'], 'rpc:minha_funcao')).toBe(false);
  });

  it('exigirEscopos lança ESCOPO_NEGADO sem revelar o escopo ao cliente', () => {
    try {
      exigirEscopos(['pedido:consultar'], ['pedido:consultar', 'cliente:consultar']);
      throw new Error('deveria lançar');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).codigo).toBe('ESCOPO_NEGADO');
      expect((e as AppError).motivoInterno).toContain('cliente:consultar');
      expect((e as AppError).detalhes).toBeUndefined();
    }
  });

  it('valida o formato dos escopos', () => {
    expect(() =>
      validarEscopos(['pedido:inserir', '*:consultar', 'rpc:*', 'operacao:pedido.assumir']),
    ).not.toThrow();
    expect(() => validarEscopos(['pedido'])).toThrow();
    expect(() => validarEscopos(['pedido:apagar'])).toThrow();
  });
});

describe('autenticarIntegrante', () => {
  it('aceita uma requisição válida', async () => {
    const { deps, headers } = await montar();
    const ctx = await autenticarIntegrante(deps, headers(), '{"a":1}');
    expect(ctx).toMatchObject({ serviceId: 'sistema2', operationId: 'op-1', admin: false });
    expect(ctx.escopos).toContain('pedido:inserir');
  });

  it('rejeita requisição repetida (replay) com o mesmo timestamp e corpo', async () => {
    const { deps, headers } = await montar();
    await autenticarIntegrante(deps, headers(), '{"a":1}');
    expect(await codigo(autenticarIntegrante(deps, headers(), '{"a":1}'))).toBe('TOKEN_INVALIDO');
    // corpo diferente é outra requisição
    expect(await codigo(autenticarIntegrante(deps, headers(), '{"a":2}'))).toBe('OK');
  });

  it('rejeita timestamp fora da tolerância, ausente ou ilegível', async () => {
    const { deps, headers } = await montar();
    expect(
      await codigo(
        autenticarIntegrante(deps, headers({ 'x-timestamp': '2026-10-19T11:50:00Z' }), '{}'),
      ),
    ).toBe('TOKEN_INVALIDO');
    expect(
      await codigo(autenticarIntegrante(deps, headers({ 'x-timestamp': 'ontem' }), '{}')),
    ).toBe('TOKEN_INVALIDO');
    expect(await codigo(autenticarIntegrante(deps, headers({ 'x-timestamp': '' }), '{}'))).toBe(
      'TOKEN_INVALIDO',
    );
  });

  it('aceita timestamp em milissegundos', async () => {
    const { deps, headers } = await montar();
    expect(
      await codigo(
        autenticarIntegrante(deps, headers({ 'x-timestamp': String(AGORA.getTime()) }), '{}'),
      ),
    ).toBe('OK');
  });

  it('rejeita sem Authorization e com X-Service-Id diferente do token', async () => {
    const { deps, headers } = await montar();
    expect(
      await codigo(autenticarIntegrante(deps, { ...headers(), authorization: undefined }, '{}')),
    ).toBe('TOKEN_INVALIDO');
    expect(
      await codigo(autenticarIntegrante(deps, headers({ 'x-service-id': 'sistema1' }), '{}')),
    ).toBe('TOKEN_INVALIDO');
  });

  it('rejeita integrante revogado, expirado e token substituído', async () => {
    const revogado = await montar({ ativo: false });
    expect(await codigo(autenticarIntegrante(revogado.deps, revogado.headers(), '{}'))).toBe(
      'TOKEN_INVALIDO',
    );

    const expirado = await montar({ expiraEm: new Date('2026-10-01T00:00:00Z') });
    expect(await codigo(autenticarIntegrante(expirado.deps, expirado.headers(), '{}'))).toBe(
      'TOKEN_INVALIDO',
    );

    const { deps } = await montar();
    const outro = emitirToken(SEGREDO, {
      serviceId: 'sistema2',
      escopos: [],
      expiraEm: new Date('2027-06-01'),
    });
    const h = {
      authorization: `Bearer ${outro}`,
      'x-timestamp': AGORA.toISOString(),
      'x-service-id': 'sistema2',
      'x-operation-id': 'o',
    };
    expect(await codigo(autenticarIntegrante(deps, h, '{}'))).toBe('TOKEN_INVALIDO');
  });

  it('exige X-Operation-Id', async () => {
    const { deps, headers } = await montar();
    expect(await codigo(autenticarIntegrante(deps, headers({ 'x-operation-id': '' }), '{}'))).toBe(
      'PAYLOAD_INVALIDO',
    );
  });
});

describe('autenticarAdmin', () => {
  const h = (chave: string) => ({
    authorization: `Bearer ${chave}`,
    'x-timestamp': AGORA.toISOString(),
    'x-operation-id': 'adm-1',
  });

  it('aceita a chave mestra e rejeita outra', async () => {
    const { deps } = await montar();
    expect(autenticarAdmin(deps, h('chave-mestra-123456'), '{}')).toMatchObject({
      admin: true,
      serviceId: 'admin',
    });
    expect(await codigo(() => autenticarAdmin(deps, h('chave-errada-1234567'), '{"x":1}'))).toBe(
      'TOKEN_INVALIDO',
    );
  });

  it('um token de integrante não serve como chave mestra', async () => {
    const { deps, token } = await montar();
    expect(await codigo(() => autenticarAdmin(deps, h(token), '{}'))).toBe('TOKEN_INVALIDO');
  });
});
