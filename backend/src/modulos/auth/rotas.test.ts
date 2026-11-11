import request from 'supertest';
import { CUSTO_DO_BCRYPT_NOS_TESTES, montarAppDeTeste } from '../../testing/appDeTeste';
import {
  DURACAO_DO_BLOQUEIO_SIMULADO_MS,
  OperadorFalso,
  type LinhaDeOperador,
} from '../../testing/operadorFalso';
import { ServicoDeSenha } from './senha';

const SENHA = 'Suprimax@2026';
const INICIO = new Date('2026-11-10T12:00:00Z');
const INATIVIDADE_MS = 30 * 60 * 1000;
const SESSAO = {
  idOperador: 7,
  usuario: 'davi',
  nome: 'davi',
  email: 'davi@suprimax.com.br',
  perfil: 'OPERADOR',
};
let senhaHash: string;

beforeAll(async () => {
  senhaHash = await new ServicoDeSenha(CUSTO_DO_BCRYPT_NOS_TESTES).gerarHash(SENHA);
});

function montar(linha: Partial<LinhaDeOperador> = {}, maximoDeFalhas?: number) {
  let agora = INICIO;
  const relogio = () => agora;
  const teste = montarAppDeTeste({
    agora: relogio,
    auth: maximoDeFalhas === undefined ? undefined : { limiteDeLogin: { maximoDeFalhas } },
  });
  const operador = new OperadorFalso(teste.proxy, { senhaHash, ...linha }, relogio);
  const avancar = (ms: number) => {
    agora = new Date(agora.getTime() + ms);
  };
  const entrar = (senha = SENHA, usuario = 'davi') =>
    request(teste.app).post('/auth/login').send({ usuario, senha });
  return { ...teste, operador, avancar, entrar };
}

describe('POST /auth/login', () => {
  it('responde 200 com o token e o usuário, sem o hash da senha', async () => {
    const resposta = await montar().entrar();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ token: expect.any(String), usuario: SESSAO });
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(resposta.text).not.toContain(senhaHash);
  });

  it('aceita espaços em volta do usuário', async () => {
    expect((await montar().entrar(SENHA, '  davi ')).status).toBe(200);
  });

  it.each([
    ['senha errada', 'senha-errada', 'davi'],
    ['usuário inexistente', SENHA, 'ninguem'],
  ])('responde 401 CREDENCIAIS_INVALIDAS: %s', async (_caso, senha, usuario) => {
    const resposta = await montar().entrar(senha, usuario);

    expect(resposta.status).toBe(401);
    expect(resposta.body).toEqual({
      codigo: 'CREDENCIAIS_INVALIDAS',
      mensagem: 'Usuário ou senha inválidos.',
    });
  });

  it('responde 423 CONTA_BLOQUEADA na terceira tentativa errada, com detalhes.bloqueadoAte', async () => {
    const { entrar } = montar();

    await entrar('errada-1');
    await entrar('errada-2');
    const resposta = await entrar('errada-3');

    expect(resposta.status).toBe(423);
    expect(resposta.body).toMatchObject({
      codigo: 'CONTA_BLOQUEADA',
      detalhes: {
        bloqueadoAte: new Date(INICIO.getTime() + DURACAO_DO_BLOQUEIO_SIMULADO_MS).toISOString(),
      },
    });
    expect((await entrar(SENHA)).status).toBe(423);
  });

  it('responde 403 USUARIO_INATIVO para usuário inativo', async () => {
    const resposta = await montar({ status: 'INATIVO' }).entrar();

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('USUARIO_INATIVO');
  });

  it.each([
    ['sem corpo', undefined, ['usuario', 'senha']],
    ['sem senha', { usuario: 'davi' }, ['senha']],
    ['usuário vazio', { usuario: '   ', senha: SENHA }, ['usuario']],
    ['usuário longo demais', { usuario: 'a'.repeat(51), senha: SENHA }, ['usuario']],
    ['senha que não é texto', { usuario: 'davi', senha: 12345678 }, ['senha']],
  ])('responde 400 VALIDATION_ERROR: %s', async (_caso, corpo, campos) => {
    const { app, proxy } = montar();

    const resposta = await request(app).post('/auth/login').send(corpo);

    expect(resposta.status).toBe(400);
    expect(resposta.body).toMatchObject({ codigo: 'VALIDATION_ERROR', detalhes: { campos } });
    expect(proxy.chamadas).toHaveLength(0);
  });

  it('responde 429 LIMITE_EXCEDIDO depois de muitas falhas do mesmo IP', async () => {
    const { entrar } = montar({}, 2);

    await entrar('errada-1', 'ninguem');
    await entrar('errada-2', 'ninguem');
    const resposta = await entrar('errada-3', 'ninguem');

    expect(resposta.status).toBe(429);
    expect(resposta.body.codigo).toBe('LIMITE_EXCEDIDO');
  });

  it('logins bem-sucedidos não contam para o limite por IP', async () => {
    const { entrar } = montar({}, 2);

    const respostas = [await entrar(), await entrar(), await entrar()];

    expect(respostas.map((resposta) => resposta.status)).toEqual([200, 200, 200]);
  });

  it('não registra a senha nem o token no log', async () => {
    const { entrar, linhas } = montar();

    const { body } = await entrar();

    expect(JSON.stringify(linhas)).not.toContain(SENHA);
    expect(JSON.stringify(linhas)).not.toContain(body.token);
  });
});

describe('GET /auth/me', () => {
  it('devolve a sessão do token', async () => {
    const { app, entrar } = montar();
    const { body } = await entrar();

    const resposta = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual(SESSAO);
  });

  it('responde 401 sem token', async () => {
    const resposta = await request(montar().app).get('/auth/me');

    expect(resposta.status).toBe(401);
    expect(resposta.body.codigo).toBe('NAO_AUTENTICADO');
  });

  it('responde 401 depois do tempo de inatividade', async () => {
    const { app, entrar, avancar } = montar();
    const { body } = await entrar();

    avancar(INATIVIDADE_MS);
    const resposta = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${body.token}`);

    expect(resposta.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('responde 204 e invalida o token', async () => {
    const { app, entrar } = montar();
    const { body } = await entrar();
    const autorizacao = `Bearer ${body.token}`;

    const saida = await request(app).post('/auth/logout').set('Authorization', autorizacao);
    const depois = await request(app).get('/auth/me').set('Authorization', autorizacao);

    expect(saida.status).toBe(204);
    expect(saida.text).toBe('');
    expect(depois.status).toBe(401);
  });

  it('responde 401 sem token', async () => {
    expect((await request(montar().app).post('/auth/logout')).status).toBe(401);
  });
});

describe('proxy indisponível', () => {
  it('o login responde 500 genérico, sem detalhe do proxy', async () => {
    const { app, proxy } = montar();
    proxy.responder('dados.consultar', new Error('connect ECONNREFUSED 10.0.0.5:3001'));

    const resposta = await request(app).post('/auth/login').send({ usuario: 'davi', senha: SENHA });

    expect(resposta.status).toBe(500);
    expect(resposta.text).not.toContain('ECONNREFUSED');
  });
});
