import { ErroProxy } from '../../dados';
import { ProxyClienteFalso, type ChamadaAoProxy } from '../../testing/proxyClienteFalso';
import {
  CACHE_DE_SESSAO_PADRAO_MS,
  INTERVALO_DE_RENOVACAO_PADRAO_MS,
  RepositorioDeSessoesEmMemoria,
  RepositorioDeSessoesNoProxy,
  resumirTokenDeSessao,
  type Sessao,
} from './sessoes';

const INATIVIDADE_MS = 30 * 60 * 1000;
const UM_MINUTO_MS = 60 * 1000;
const SESSAO: Sessao = {
  idOperador: 7,
  usuario: 'davi',
  nome: 'davi',
  email: 'davi@suprimax.com.br',
  perfil: 'OPERADOR',
};

function montar() {
  let agora = new Date('2026-11-10T12:00:00Z');
  const sessoes = new RepositorioDeSessoesEmMemoria({
    inatividadeMs: INATIVIDADE_MS,
    agora: () => agora,
  });
  const avancar = (ms: number) => {
    agora = new Date(agora.getTime() + ms);
  };
  return { sessoes, avancar };
}

describe('RepositorioDeSessoesEmMemoria', () => {
  it('cria a sessão e a devolve pelo token', async () => {
    const { sessoes } = montar();

    const token = await sessoes.criar(SESSAO);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sessoes.buscar(token)).toEqual(SESSAO);
  });

  it('gera um token diferente a cada sessão', async () => {
    const { sessoes } = montar();

    expect(await sessoes.criar(SESSAO)).not.toBe(await sessoes.criar(SESSAO));
  });

  it.each(['', 'token-desconhecido'])('não encontra o token "%s"', async (token) => {
    expect(await montar().sessoes.buscar(token)).toBeNull();
  });

  it('expira depois do tempo de inatividade e remove a sessão', async () => {
    const { sessoes, avancar } = montar();
    const token = await sessoes.criar(SESSAO);

    avancar(INATIVIDADE_MS);

    expect(await sessoes.buscar(token)).toBeNull();
    expect(sessoes.quantidade).toBe(0);
  });

  it('renova o prazo a cada uso', async () => {
    const { sessoes, avancar } = montar();
    const token = await sessoes.criar(SESSAO);

    avancar(INATIVIDADE_MS - UM_MINUTO_MS);
    expect(await sessoes.buscar(token)).toEqual(SESSAO);
    avancar(INATIVIDADE_MS - UM_MINUTO_MS);

    expect(await sessoes.buscar(token)).toEqual(SESSAO);
  });

  it('encerra só a sessão do token informado', async () => {
    const { sessoes } = montar();
    const [primeiro, segundo] = [await sessoes.criar(SESSAO), await sessoes.criar(SESSAO)];

    await sessoes.encerrar(primeiro);
    await sessoes.encerrar('token-desconhecido');

    expect(await sessoes.buscar(primeiro)).toBeNull();
    expect(await sessoes.buscar(segundo)).toEqual(SESSAO);
  });

  it('encerra todas as sessões de um operador, sem tocar nas dos outros', async () => {
    const { sessoes } = montar();
    const outra: Sessao = { ...SESSAO, idOperador: 8 };
    const tokens = [await sessoes.criar(SESSAO), await sessoes.criar(SESSAO)];
    const tokenDaOutra = await sessoes.criar(outra);

    await sessoes.encerrarDoOperador(SESSAO.idOperador);

    expect(await sessoes.buscar(tokens[0] ?? '')).toBeNull();
    expect(await sessoes.buscar(tokens[1] ?? '')).toBeNull();
    expect(await sessoes.buscar(tokenDaOutra)).toEqual(outra);
  });

  it('remove as expiradas na limpeza e mantém as demais', async () => {
    const { sessoes, avancar } = montar();
    await sessoes.criar(SESSAO);
    avancar(INATIVIDADE_MS - UM_MINUTO_MS);
    const recente = await sessoes.criar(SESSAO);
    avancar(2 * UM_MINUTO_MS);

    expect(sessoes.removerExpiradas()).toBe(1);
    expect(await sessoes.buscar(recente)).toEqual(SESSAO);
  });

  it('não guarda o token em texto puro', async () => {
    const { sessoes } = montar();

    const token = await sessoes.criar(SESSAO);

    expect(JSON.stringify([...sessoes['sessoes'].entries()])).not.toContain(token);
  });

  it('liga e desliga a limpeza periódica sem segurar o processo', () => {
    const { sessoes } = montar();

    sessoes.iniciarLimpeza();
    sessoes.iniciarLimpeza();
    expect(sessoes['temporizador']?.hasRef()).toBe(false);
    sessoes.pararLimpeza();

    expect(sessoes['temporizador']).toBeUndefined();
  });
});

interface LinhaDeSessao {
  idOperador: number;
  expiraEm: number;
}

/**
 * Proxy de mentira com a tabela `sessao` e os operadores em memória, imitando as operações
 * `sessao.*` do proxy (prazo pelo relógio "do banco", que aqui é o mesmo relógio do teste).
 */
function montarNoProxy(opcoes: { cacheMs?: number; intervaloDeRenovacaoMs?: number } = {}) {
  let agora = new Date('2026-11-10T12:00:00Z');
  const tabela = new Map<string, LinhaDeSessao>();
  const operadores = new Map<
    number,
    { usuario: string; email: string; perfil: string; status: string }
  >([
    [7, { usuario: 'davi', email: 'davi@suprimax.com.br', perfil: 'OPERADOR', status: 'ATIVO' }],
    [8, { usuario: 'eva', email: 'eva@suprimax.com.br', perfil: 'GESTOR', status: 'ATIVO' }],
  ]);
  const proxy = new ProxyClienteFalso();
  const p = (c: ChamadaAoProxy) => c.payload as Record<string, unknown>;
  proxy.responder('sessao.criar', (c: ChamadaAoProxy) => {
    const { token_hash, id_operador, validade_segundos } = p(c);
    tabela.set(String(token_hash), {
      idOperador: Number(id_operador),
      expiraEm: agora.getTime() + Number(validade_segundos) * 1000,
    });
    return { ok: true, dados: {} };
  });
  proxy.responder('sessao.buscar', (c: ChamadaAoProxy) => {
    const { token_hash, renovar_segundos } = p(c);
    const linha = tabela.get(String(token_hash));
    if (!linha || linha.expiraEm <= agora.getTime()) {
      return { ok: true, dados: null };
    }
    if (renovar_segundos !== undefined) {
      linha.expiraEm = Math.max(linha.expiraEm, agora.getTime() + Number(renovar_segundos) * 1000);
    }
    return {
      ok: true,
      dados: { idOperador: linha.idOperador, ...operadores.get(linha.idOperador) },
    };
  });
  proxy.responder('sessao.encerrar', (c: ChamadaAoProxy) => {
    return { ok: true, afetados: tabela.delete(String(p(c).token_hash)) ? 1 : 0 };
  });
  proxy.responder('sessao.encerrar_operador', (c: ChamadaAoProxy) => {
    let afetados = 0;
    for (const [hash, linha] of tabela) {
      if (linha.idOperador === p(c).id_operador) {
        tabela.delete(hash);
        afetados += 1;
      }
    }
    return { ok: true, afetados };
  });
  proxy.responder('sessao.remover_expiradas', () => {
    let afetados = 0;
    for (const [hash, linha] of tabela) {
      if (linha.expiraEm <= agora.getTime()) {
        tabela.delete(hash);
        afetados += 1;
      }
    }
    return { ok: true, afetados };
  });
  const sessoes = new RepositorioDeSessoesNoProxy({
    proxy,
    inatividadeMs: INATIVIDADE_MS,
    agora: () => agora,
    ...opcoes,
  });
  const avancar = (ms: number) => {
    agora = new Date(agora.getTime() + ms);
  };
  /** Outro processo (deploy novo): mesmo "banco", cache vazio. */
  const reiniciar = () =>
    new RepositorioDeSessoesNoProxy({ proxy, inatividadeMs: INATIVIDADE_MS, agora: () => agora });
  return { sessoes, proxy, tabela, operadores, avancar, reiniciar };
}

describe('RepositorioDeSessoesNoProxy', () => {
  it('cria a sessão no banco só com o hash do token e o prazo de inatividade', async () => {
    const { sessoes, proxy, tabela } = montarNoProxy();

    const token = await sessoes.criar(SESSAO);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [chamada] = proxy.chamadasDe('sessao.criar');
    expect(chamada?.payload).toEqual({
      token_hash: resumirTokenDeSessao(token),
      id_operador: SESSAO.idOperador,
      validade_segundos: INATIVIDADE_MS / 1000,
    });
    expect(chamada?.operationId).toBe('UC13-sessao-criar');
    expect(JSON.stringify(proxy.chamadas)).not.toContain(token);
    expect([...tabela.keys()]).toEqual([resumirTokenDeSessao(token)]);
  });

  it('a sessão sobrevive ao reinício do backend (outro processo, mesmo banco)', async () => {
    const { sessoes, reiniciar } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);

    expect(await reiniciar().buscar(token)).toEqual(SESSAO);
  });

  it('usa o cache por alguns segundos e só então volta ao proxy, sem renovar antes do intervalo', async () => {
    const { sessoes, proxy, avancar } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);

    expect(await sessoes.buscar(token)).toEqual(SESSAO);
    avancar(CACHE_DE_SESSAO_PADRAO_MS - 1);
    expect(await sessoes.buscar(token)).toEqual(SESSAO);
    expect(proxy.chamadasDe('sessao.buscar')).toHaveLength(0);

    avancar(1);
    expect(await sessoes.buscar(token)).toEqual(SESSAO);
    expect(proxy.chamadasDe('sessao.buscar').map((c) => c.payload)).toEqual([
      { token_hash: resumirTokenDeSessao(token) },
    ]);
  });

  it('renova o prazo no banco no máximo uma vez por minuto', async () => {
    const { sessoes, proxy, tabela, avancar } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);
    const hash = resumirTokenDeSessao(token);

    for (let i = 0; i < 12; i += 1) {
      avancar(CACHE_DE_SESSAO_PADRAO_MS);
      await sessoes.buscar(token);
    }
    const renovacoes = proxy
      .chamadasDe('sessao.buscar')
      .filter((c) => c.payload.renovar_segundos !== undefined);
    expect(renovacoes).toHaveLength(1);
    expect(renovacoes[0]?.payload).toEqual({
      token_hash: hash,
      renovar_segundos: INATIVIDADE_MS / 1000,
    });
    expect(tabela.get(hash)?.expiraEm).toBe(
      new Date('2026-11-10T12:00:00Z').getTime() +
        INTERVALO_DE_RENOVACAO_PADRAO_MS +
        INATIVIDADE_MS,
    );
  });

  it('com uso contínuo não expira; parada pelo tempo de inatividade, expira', async () => {
    const { sessoes, avancar } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);

    for (let i = 0; i < 3; i += 1) {
      avancar(INATIVIDADE_MS - UM_MINUTO_MS);
      expect(await sessoes.buscar(token)).toEqual(SESSAO);
    }
    avancar(INATIVIDADE_MS);
    expect(await sessoes.buscar(token)).toBeNull();
    expect(sessoes.quantidadeEmCache).toBe(0);
  });

  it.each(['', 'token-desconhecido'])('não encontra o token "%s"', async (token) => {
    expect(await montarNoProxy().sessoes.buscar(token)).toBeNull();
  });

  it('logout apaga no banco e no cache na hora', async () => {
    const { sessoes, tabela } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);
    const outro = await sessoes.criar(SESSAO);

    await sessoes.encerrar(token);

    expect(await sessoes.buscar(token)).toBeNull();
    expect(await sessoes.buscar(outro)).toEqual(SESSAO);
    expect(tabela.size).toBe(1);
  });

  it('encerrar do operador apaga as dele no banco e no cache, sem tocar nas dos outros', async () => {
    const { sessoes, proxy } = montarNoProxy();
    const outra: Sessao = { ...SESSAO, idOperador: 8, usuario: 'eva', nome: 'eva' };
    const tokens = [await sessoes.criar(SESSAO), await sessoes.criar(SESSAO)];
    const tokenDaOutra = await sessoes.criar(outra);

    await sessoes.encerrarDoOperador(SESSAO.idOperador);

    expect(proxy.chamadasDe('sessao.encerrar_operador')[0]?.payload).toEqual({ id_operador: 7 });
    expect(await sessoes.buscar(tokens[0] ?? '')).toBeNull();
    expect(await sessoes.buscar(tokens[1] ?? '')).toBeNull();
    expect(await sessoes.buscar(tokenDaOutra)).toEqual(outra);
  });

  it('traz os dados atuais do operador e recusa operador inativo ou com perfil desconhecido', async () => {
    const { sessoes, operadores, reiniciar } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);

    operadores.set(7, {
      usuario: 'davi',
      email: 'novo@suprimax.com.br',
      perfil: 'FISCAL',
      status: 'ATIVO',
    });
    expect(await reiniciar().buscar(token)).toEqual({
      ...SESSAO,
      email: 'novo@suprimax.com.br',
      perfil: 'FISCAL',
    });

    operadores.set(7, { usuario: 'davi', email: 'd@x', perfil: 'SUPERUSUARIO', status: 'ATIVO' });
    expect(await reiniciar().buscar(token)).toBeNull();

    operadores.set(7, { usuario: 'davi', email: 'd@x', perfil: 'OPERADOR', status: 'INATIVO' });
    expect(await reiniciar().buscar(token)).toBeNull();
  });

  it('falha do proxy na busca não vira "sem sessão": o erro segue para o tratamento padrão', async () => {
    const { sessoes, proxy, reiniciar } = montarNoProxy();
    const token = await sessoes.criar(SESSAO);
    proxy.responder('sessao.buscar', new ErroProxy(503, 'FALHA_DE_REDE', 'O proxy não respondeu.'));

    await expect(reiniciar().buscar(token)).rejects.toBeInstanceOf(ErroProxy);
  });

  it('limparExpiradas remove as vencidas no banco e devolve quantas', async () => {
    const { sessoes, tabela, avancar } = montarNoProxy();
    await sessoes.criar(SESSAO);
    avancar(INATIVIDADE_MS - UM_MINUTO_MS);
    const recente = await sessoes.criar(SESSAO);
    avancar(2 * UM_MINUTO_MS);

    expect(await sessoes.limparExpiradas()).toBe(1);
    expect([...tabela.keys()]).toEqual([resumirTokenDeSessao(recente)]);
    expect(sessoes.quantidadeEmCache).toBe(1);
  });

  it('com inatividade curta, renova pelo menos a cada metade do prazo', async () => {
    const proxy = new ProxyClienteFalso().responder('sessao.criar', { ok: true, dados: {} });
    proxy.responder('sessao.buscar', {
      ok: true,
      dados: {
        idOperador: 7,
        usuario: 'davi',
        email: SESSAO.email,
        perfil: 'OPERADOR',
        status: 'ATIVO',
      },
    });
    let agora = 0;
    const sessoes = new RepositorioDeSessoesNoProxy({
      proxy,
      inatividadeMs: UM_MINUTO_MS,
      agora: () => new Date(agora),
    });
    const token = await sessoes.criar(SESSAO);

    agora = UM_MINUTO_MS / 2;
    await sessoes.buscar(token);

    expect(proxy.chamadasDe('sessao.buscar')[0]?.payload).toMatchObject({ renovar_segundos: 60 });
  });
});
