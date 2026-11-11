import { ErroInterno } from '../../erros';
import { ProxyClienteFalso } from '../../testing/proxyClienteFalso';
import { RepositorioDeOperadores, type CredenciaisDoOperador } from './operadores';

const AGORA = new Date('2026-11-10T12:00:00Z');
const LINHA = {
  idOperador: 7,
  usuario: 'davi',
  email: 'davi@suprimax.com.br',
  perfil: 'OPERADOR',
  status: 'ATIVO',
  senhaHash: '$2b$12$hash',
  tentativasLoginInvalidas: 1,
  bloqueadoAte: null,
};
const OPERADOR: CredenciaisDoOperador = { ...LINHA, perfil: 'OPERADOR', status: 'ATIVO' };

function montar() {
  const proxy = new ProxyClienteFalso();
  return { proxy, operadores: new RepositorioDeOperadores(proxy) };
}

describe('RepositorioDeOperadores.buscarCredenciais', () => {
  it('consulta o operador pelo usuário, pedindo o hash da senha', async () => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.consultar', { ok: true, dados: [LINHA], proximoCursor: null });

    expect(await operadores.buscarCredenciais('davi')).toEqual(OPERADOR);
    expect(proxy.chamadas).toEqual([
      {
        operacao: 'dados.consultar',
        operationId: 'UC13-login',
        payload: {
          tabela: 'operador',
          campos: [
            'id_operador',
            'usuario',
            'email',
            'perfil',
            'status',
            'senha_hash',
            'tentativas_login_invalidas',
            'bloqueado_ate',
          ],
          filtros: { e: [['usuario', '=', 'davi']] },
          limite: 1,
        },
      },
    ]);
  });

  it('devolve null quando o usuário não existe', async () => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.consultar', { ok: true, dados: [], proximoCursor: null });

    expect(await operadores.buscarCredenciais('ninguem')).toBeNull();
  });

  it.each([
    ['2026-11-10T12:15:00', '2026-11-10T12:15:00.000Z'],
    ['2026-11-10 12:15:00', '2026-11-10T12:15:00.000Z'],
    ['2026-11-10T12:15:00.000Z', '2026-11-10T12:15:00.000Z'],
    ['2026-11-10T09:15:00-03:00', '2026-11-10T12:15:00.000Z'],
  ])('lê bloqueado_ate "%s" como %s (sem fuso é UTC)', async (texto, esperado) => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.consultar', { ok: true, dados: [{ ...LINHA, bloqueadoAte: texto }] });

    const operador = await operadores.buscarCredenciais('davi');

    expect(operador?.bloqueadoAte?.toISOString()).toBe(esperado);
  });

  it.each([
    ['perfil desconhecido', { perfil: 'ADMIN' }],
    ['sem hash de senha', { senhaHash: undefined }],
    ['data inválida', { bloqueadoAte: 'amanhã' }],
  ])('trata linha fora do formato (%s) como erro interno', async (_caso, defeito) => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.consultar', { ok: true, dados: [{ ...LINHA, ...defeito }] });

    await expect(operadores.buscarCredenciais('davi')).rejects.toBeInstanceOf(ErroInterno);
  });
});

describe('RepositorioDeOperadores.registrarFalha', () => {
  const BLOQUEIO_VENCIDO = new Date('2026-11-10T11:00:00Z');
  const BLOQUEIO_VIGENTE = new Date('2026-11-10T12:10:00Z');

  it.each([
    ['primeira falha', { tentativasLoginInvalidas: 0 }, 1],
    ['segunda falha', { tentativasLoginInvalidas: 1 }, 2],
    ['terceira falha', { tentativasLoginInvalidas: 2 }, 3],
    ['contador já no teto', { tentativasLoginInvalidas: 3 }, 3],
    [
      'bloqueio vencido recomeça a contagem',
      { tentativasLoginInvalidas: 3, bloqueadoAte: BLOQUEIO_VENCIDO },
      1,
    ],
    [
      'bloqueio vigente continua contando',
      { tentativasLoginInvalidas: 2, bloqueadoAte: BLOQUEIO_VIGENTE },
      3,
    ],
  ])('%s: grava %p → %i', async (_caso, estado, esperado) => {
    const { proxy, operadores } = montar();
    const operador = { ...OPERADOR, ...estado };
    proxy.responder('dados.atualizar', {
      ok: true,
      afetados: 1,
      dados: [{ tentativasLoginInvalidas: esperado, bloqueadoAte: null }],
    });

    await operadores.registrarFalha(operador, AGORA);

    expect(proxy.chamadas[0]).toEqual({
      operacao: 'dados.atualizar',
      operationId: 'UC13-login-falha',
      payload: {
        tabela: 'operador',
        filtros: {
          e: [
            ['id_operador', '=', 7],
            ['tentativas_login_invalidas', '=', operador.tentativasLoginInvalidas],
          ],
        },
        valores: { tentativas_login_invalidas: esperado },
        retornar: ['tentativas_login_invalidas', 'bloqueado_ate'],
      },
    });
  });

  it('devolve o bloqueio gravado pelo gatilho do banco', async () => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.atualizar', {
      ok: true,
      afetados: 1,
      dados: [{ tentativasLoginInvalidas: 3, bloqueadoAte: '2026-11-10T12:15:00' }],
    });

    expect(await operadores.registrarFalha(OPERADOR, AGORA)).toEqual({
      tentativasLoginInvalidas: 3,
      bloqueadoAte: new Date('2026-11-10T12:15:00Z'),
    });
  });

  it('se outra tentativa mudou o contador antes, lê o estado que ela deixou', async () => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.atualizar', { ok: true, afetados: 0, dados: [] });
    proxy.responder('dados.consultar', {
      ok: true,
      dados: [{ tentativasLoginInvalidas: 3, bloqueadoAte: '2026-11-10T12:15:00Z' }],
    });

    expect(await operadores.registrarFalha(OPERADOR, AGORA)).toEqual({
      tentativasLoginInvalidas: 3,
      bloqueadoAte: new Date('2026-11-10T12:15:00Z'),
    });
    expect(proxy.chamadasDe('dados.consultar')[0]?.payload).toMatchObject({
      campos: ['tentativas_login_invalidas', 'bloqueado_ate'],
      filtros: { e: [['id_operador', '=', 7]] },
    });
  });
});

describe('RepositorioDeOperadores.zerarTentativas', () => {
  it('grava só o contador: bloqueado_ate é do gatilho do banco', async () => {
    const { proxy, operadores } = montar();
    proxy.responder('dados.atualizar', { ok: true, afetados: 1 });

    await operadores.zerarTentativas(7);

    expect(proxy.chamadas).toEqual([
      {
        operacao: 'dados.atualizar',
        operationId: 'UC13-login-sucesso',
        payload: {
          tabela: 'operador',
          filtros: { e: [['id_operador', '=', 7]] },
          valores: { tentativas_login_invalidas: 0 },
        },
      },
    ]);
  });
});
