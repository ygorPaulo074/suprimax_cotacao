import {
  ErroDeContaBloqueada,
  ErroDeCredenciaisInvalidas,
  ErroDeUsuarioInativo,
} from '../../erros';
import { criarLogger } from '../../log';
import { CUSTO_DO_BCRYPT_NOS_TESTES } from '../../testing/appDeTeste';
import {
  DURACAO_DO_BLOQUEIO_SIMULADO_MS,
  OperadorFalso,
  type LinhaDeOperador,
} from '../../testing/operadorFalso';
import { ProxyClienteFalso } from '../../testing/proxyClienteFalso';
import { RepositorioDeOperadores } from './operadores';
import { ServicoDeSenha } from './senha';
import { ServicoDeAutenticacao } from './servico';
import { RepositorioDeSessoesEmMemoria } from './sessoes';

const SENHA = 'Suprimax@2026';
const SENHA_ERRADA = 'senha-errada';
const INICIO = new Date('2026-11-10T12:00:00Z');
const senhas = new ServicoDeSenha(CUSTO_DO_BCRYPT_NOS_TESTES);
let senhaHash: string;

beforeAll(async () => {
  senhaHash = await senhas.gerarHash(SENHA);
});

function montar(linha: Partial<LinhaDeOperador> = {}) {
  let agora = INICIO;
  const relogio = () => agora;
  const linhasDeLog: string[] = [];
  const proxy = new ProxyClienteFalso();
  const operador = new OperadorFalso(proxy, { senhaHash, ...linha }, relogio);
  const sessoes = new RepositorioDeSessoesEmMemoria({ inatividadeMs: 60_000, agora: relogio });
  const servico = new ServicoDeAutenticacao({
    operadores: new RepositorioDeOperadores(proxy),
    sessoes,
    senhas,
    logger: criarLogger({ nivel: 'info', destino: { write: (l) => void linhasDeLog.push(l) } }),
    agora: relogio,
  });
  const avancar = (ms: number) => {
    agora = new Date(agora.getTime() + ms);
  };
  const entrar = (senha: string, usuario = 'davi') => servico.entrar({ usuario, senha }, 'req-1');
  return { servico, sessoes, proxy, operador, linhasDeLog, avancar, entrar };
}

describe('ServicoDeAutenticacao.entrar', () => {
  it('com a senha certa, abre a sessão e devolve o token e o usuário', async () => {
    const { entrar, sessoes, proxy } = montar();

    const resultado = await entrar(SENHA);

    expect(resultado.usuario).toEqual({
      idOperador: 7,
      usuario: 'davi',
      nome: 'davi',
      email: 'davi@suprimax.com.br',
      perfil: 'OPERADOR',
    });
    expect(await sessoes.buscar(resultado.token)).toEqual(resultado.usuario);
    expect(proxy.chamadasDe('dados.atualizar')).toHaveLength(0);
  });

  it('usuário inexistente recebe a mesma resposta de senha errada', async () => {
    const { entrar, proxy } = montar();

    await expect(entrar(SENHA, 'ninguem')).rejects.toBeInstanceOf(ErroDeCredenciaisInvalidas);
    expect(proxy.chamadasDe('dados.atualizar')).toHaveLength(0);
  });

  it('senha errada conta a tentativa', async () => {
    const { entrar, operador } = montar();

    await expect(entrar(SENHA_ERRADA)).rejects.toBeInstanceOf(ErroDeCredenciaisInvalidas);
    expect(operador.linha.tentativasLoginInvalidas).toBe(1);
  });

  it('a terceira senha errada já responde conta bloqueada, com o fim do bloqueio', async () => {
    const { entrar } = montar();

    await expect(entrar(SENHA_ERRADA)).rejects.toBeInstanceOf(ErroDeCredenciaisInvalidas);
    await expect(entrar(SENHA_ERRADA)).rejects.toBeInstanceOf(ErroDeCredenciaisInvalidas);
    const erro = await entrar(SENHA_ERRADA).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroDeContaBloqueada);
    expect((erro as ErroDeContaBloqueada).detalhes).toEqual({
      bloqueadoAte: new Date(INICIO.getTime() + DURACAO_DO_BLOQUEIO_SIMULADO_MS).toISOString(),
    });
  });

  it('conta bloqueada recusa até a senha certa, sem contar tentativa', async () => {
    const bloqueadoAte = new Date(INICIO.getTime() + 60_000).toISOString();
    const { entrar, proxy } = montar({ tentativasLoginInvalidas: 3, bloqueadoAte });

    await expect(entrar(SENHA)).rejects.toBeInstanceOf(ErroDeContaBloqueada);
    expect(proxy.chamadasDe('dados.atualizar')).toHaveLength(0);
  });

  it('depois que o bloqueio vence, a senha certa entra e zera o contador', async () => {
    const { entrar, avancar, operador } = montar();
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      await entrar(SENHA_ERRADA).catch(() => undefined);
    }

    avancar(DURACAO_DO_BLOQUEIO_SIMULADO_MS);

    expect((await entrar(SENHA)).usuario.idOperador).toBe(7);
    expect(operador.linha.tentativasLoginInvalidas).toBe(0);
  });

  it('depois que o bloqueio vence, uma senha errada recomeça a contagem em 1', async () => {
    const bloqueadoAte = new Date(INICIO.getTime() - 1).toISOString();
    const { entrar, operador } = montar({ tentativasLoginInvalidas: 3, bloqueadoAte });

    await expect(entrar(SENHA_ERRADA)).rejects.toBeInstanceOf(ErroDeCredenciaisInvalidas);
    expect(operador.linha.tentativasLoginInvalidas).toBe(1);
  });

  it('usuário inativo com a senha certa tem o acesso negado e não ganha sessão', async () => {
    const { entrar, sessoes } = montar({ status: 'INATIVO' });

    await expect(entrar(SENHA)).rejects.toBeInstanceOf(ErroDeUsuarioInativo);
    expect(sessoes.quantidade).toBe(0);
  });

  it('usuário inativo com a senha errada recebe credenciais inválidas', async () => {
    const { entrar } = montar({ status: 'INATIVO' });

    await expect(entrar(SENHA_ERRADA)).rejects.toBeInstanceOf(ErroDeCredenciaisInvalidas);
  });

  it.each([
    ['sucesso', SENHA, 'davi', 'sucesso', 7],
    ['senha errada', SENHA_ERRADA, 'davi', 'senha_incorreta', 7],
    [
      'usuário inexistente',
      SENHA,
      'ninguem-digitou-a-senha-aqui',
      'usuario_desconhecido',
      undefined,
    ],
  ])('registra no log só o resultado e o id (%s)', async (_caso, senha, usuario, resultado, id) => {
    const { entrar, linhasDeLog } = montar();

    await entrar(senha, usuario).catch(() => undefined);

    expect(JSON.parse(linhasDeLog[0] ?? '')).toMatchObject({ requestId: 'req-1', resultado });
    expect(JSON.parse(linhasDeLog[0] ?? '').idOperador).toBe(id);
    const log = linhasDeLog.join();
    expect(log).not.toContain(senha);
    expect(log).not.toContain(senhaHash);
    expect(log).not.toContain('ninguem-digitou-a-senha-aqui');
  });
});

describe('ServicoDeAutenticacao.sair', () => {
  it('encerra a sessão do token', async () => {
    const { entrar, servico, sessoes } = montar();
    const { token } = await entrar(SENHA);

    await servico.sair(token);

    expect(await sessoes.buscar(token)).toBeNull();
  });
});
