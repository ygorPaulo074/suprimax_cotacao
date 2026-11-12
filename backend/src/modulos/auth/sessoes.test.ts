import { RepositorioDeSessoesEmMemoria, type Sessao } from './sessoes';

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
