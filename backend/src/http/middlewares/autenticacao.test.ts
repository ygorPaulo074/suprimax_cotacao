import express from 'express';
import request from 'supertest';
import { criarLogger } from '../../log';
import { PERFIS, RepositorioDeSessoesEmMemoria, type Sessao } from '../../modulos/auth/sessoes';
import { exigirPerfil, exigirSessao, obterSessao, obterTokenDaSessao } from './autenticacao';
import { tratamentoDeErros } from './tratamentoDeErros';

const INATIVIDADE_MS = 60_000;
const SESSAO: Sessao = {
  idOperador: 7,
  usuario: 'davi',
  nome: 'davi',
  email: 'davi@suprimax.com.br',
  perfil: 'OPERADOR',
};

async function montar(sessao: Sessao = SESSAO) {
  let agora = new Date('2026-11-10T12:00:00Z');
  const sessoes = new RepositorioDeSessoesEmMemoria({
    inatividadeMs: INATIVIDADE_MS,
    agora: () => agora,
  });
  const token = await sessoes.criar(sessao);
  const app = express();
  app.get('/protegida', exigirSessao(sessoes), (_req, res) => {
    res.json({ sessao: obterSessao(res), token: obterTokenDaSessao(res) });
  });
  app.get(
    '/chefia',
    exigirSessao(sessoes),
    exigirPerfil('OPERADOR_CHEFE', 'GESTOR'),
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  app.get('/sem-middleware', (_req, res) => {
    res.json(obterSessao(res));
  });
  app.use(tratamentoDeErros(criarLogger({ nivel: 'silent' })));
  const avancar = (ms: number) => {
    agora = new Date(agora.getTime() + ms);
  };
  return { app, token, avancar };
}

describe('exigirSessao', () => {
  it('libera a rota e entrega a sessão e o token', async () => {
    const { app, token } = await montar();

    const resposta = await request(app).get('/protegida').set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ sessao: SESSAO, token });
  });

  it.each([
    ['sem cabeçalho', undefined],
    ['cabeçalho vazio', ''],
    ['sem o esquema Bearer', 'TOKEN'],
    ['esquema Basic', 'Basic TOKEN'],
    ['Bearer sem token', 'Bearer '],
    ['token desconhecido', 'Bearer token-desconhecido'],
    ['token com texto a mais', 'Bearer TOKEN extra'],
  ])('responde 401 NAO_AUTENTICADO: %s', async (_caso, cabecalho) => {
    const { app, token } = await montar();
    const requisicao = request(app).get('/protegida');
    if (cabecalho !== undefined) {
      void requisicao.set('Authorization', cabecalho.replace('TOKEN', token));
    }

    const resposta = await requisicao;

    expect(resposta.status).toBe(401);
    expect(resposta.body.codigo).toBe('NAO_AUTENTICADO');
  });

  it('responde 401 quando a sessão expirou por inatividade', async () => {
    const { app, token, avancar } = await montar();

    avancar(INATIVIDADE_MS);
    const resposta = await request(app).get('/protegida').set('Authorization', `Bearer ${token}`);

    expect(resposta.status).toBe(401);
  });

  it('cada requisição renova o prazo da sessão', async () => {
    const { app, token, avancar } = await montar();
    const chamar = () => request(app).get('/protegida').set('Authorization', `Bearer ${token}`);

    avancar(INATIVIDADE_MS - 1);
    expect((await chamar()).status).toBe(200);
    avancar(INATIVIDADE_MS - 1);

    expect((await chamar()).status).toBe(200);
  });
});

describe('exigirPerfil', () => {
  it.each(PERFIS.map((perfil) => [perfil, ['OPERADOR_CHEFE', 'GESTOR'].includes(perfil)]))(
    'perfil %s: liberado = %s',
    async (perfil, liberado) => {
      const { app, token } = await montar({ ...SESSAO, perfil });

      const resposta = await request(app).get('/chefia').set('Authorization', `Bearer ${token}`);

      expect(resposta.status).toBe(liberado ? 200 : 403);
      expect(resposta.body.codigo).toBe(liberado ? undefined : 'ACESSO_NEGADO');
    },
  );
});

describe('obterSessao', () => {
  it('em rota sem exigirSessao, responde 401 em vez de entregar uma sessão vazia', async () => {
    const { app } = await montar();

    expect((await request(app).get('/sem-middleware')).status).toBe(401);
  });
});
