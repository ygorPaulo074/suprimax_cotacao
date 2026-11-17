// RNF06, UC16-A1 — middleware de idempotência e o reenvio de `POST /orcamentos/:id/itens`.
import express from 'express';
import request from 'supertest';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';
import { idempotencia } from './idempotencia';
import { tratamentoDeErros } from './tratamentoDeErros';

function montarAppMinimo(opcoes: Parameters<typeof idempotencia>[0] = {}) {
  const execucoes = { total: 0 };
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals['sessao'] = {
      idOperador: 1,
      usuario: 'a',
      nome: 'a',
      email: 'a@a',
      perfil: 'OPERADOR',
    };
    next();
  });
  app.post('/x', idempotencia(opcoes), (_req, res) => {
    execucoes.total += 1;
    res.status(201).json({ n: execucoes.total });
  });
  app.use(tratamentoDeErros({ error: jest.fn() } as never));
  return { app, execucoes };
}

describe('idempotencia', () => {
  it('sem cabeçalho executa toda vez', async () => {
    const { app, execucoes } = montarAppMinimo();
    await request(app).post('/x').send({ a: 1 });
    await request(app).post('/x').send({ a: 1 });
    expect(execucoes.total).toBe(2);
  });

  it('mesma chave e mesmo corpo repete status e corpo sem reexecutar', async () => {
    const { app, execucoes } = montarAppMinimo();
    const primeira = await request(app).post('/x').set('Idempotency-Key', 'k1').send({ a: 1 });
    const segunda = await request(app).post('/x').set('Idempotency-Key', 'k1').send({ a: 1 });
    expect(segunda.status).toBe(201);
    expect(segunda.body).toEqual(primeira.body);
    expect(segunda.headers['idempotency-replayed']).toBe('true');
    expect(execucoes.total).toBe(1);
  });

  it('mesma chave com corpo diferente responde 422 no formato padrão', async () => {
    const { app } = montarAppMinimo();
    await request(app).post('/x').set('Idempotency-Key', 'k1').send({ a: 1 });
    const resposta = await request(app).post('/x').set('Idempotency-Key', 'k1').send({ a: 2 });
    expect(resposta.status).toBe(422);
    expect(resposta.body).toEqual({
      codigo: 'IDEMPOTENCY_KEY_REUSADA',
      mensagem: expect.any(String),
    });
  });

  it('chaves diferentes executam separadamente; chave inválida responde 400', async () => {
    const { app, execucoes } = montarAppMinimo();
    await request(app).post('/x').set('Idempotency-Key', 'k1').send({});
    await request(app).post('/x').set('Idempotency-Key', 'k2').send({});
    expect(execucoes.total).toBe(2);
    const invalida = await request(app).post('/x').set('Idempotency-Key', 'com espaço').send({});
    expect(invalida.status).toBe(400);
  });

  it('depois do TTL a chave expira e a requisição executa de novo', async () => {
    let agora = 0;
    const { app, execucoes } = montarAppMinimo({ ttlMs: 1000, agora: () => agora });
    await request(app).post('/x').set('Idempotency-Key', 'k1').send({});
    agora = 1001;
    await request(app).post('/x').set('Idempotency-Key', 'k1').send({});
    expect(execucoes.total).toBe(2);
  });

  it('respeita o limite de chaves, descartando a mais antiga', async () => {
    const { app, execucoes } = montarAppMinimo({ maximoDeChaves: 2 });
    for (const k of ['a', 'b', 'c']) {
      await request(app).post('/x').set('Idempotency-Key', k).send({});
    }
    await request(app).post('/x').set('Idempotency-Key', 'a').send({});
    expect(execucoes.total).toBe(4);
  });
});

describe('POST /orcamentos/:id/itens com Idempotency-Key (UC16-A1)', () => {
  it('reenviar a mesma requisição não soma a quantidade duas vezes', async () => {
    const cenario = montarCenarioDeCadastros();
    const operador = await cenario.entrarComo('OPERADOR');
    const idVendedor = cenario.semearUsuario('VENDEDOR', 'vendedor-idem');
    const [cliente] = cenario.banco.semear('cliente', {
      cnpj: '41000000000001',
      razao_social: 'Cliente Idem',
      nome_contato: 'Contato',
      tipo_unidade: 'MATRIZ',
      id_operador_vendedor: idVendedor,
      aceite_lgpd: true,
      data_aceite_lgpd: new Date().toISOString(),
    });
    const [produto] = cenario.banco.semear('produto', {
      codigo_interno: 'PROD-IDEM',
      descricao: 'Papel',
    });
    const [variacao] = cenario.banco.semear('variacao_produto', {
      id_produto: produto?.id_produto,
      marca: 'M',
      tamanho_embalagem: '30m',
      quantidade_estoque: 1000,
    });
    const idVariacao = variacao?.id_variacao as number;
    cenario.banco.semear('faixa_preco', {
      id_variacao: idVariacao,
      quantidade_minima: 1,
      preco_unitario: '6.00',
    });
    const { body: orcamento } = await request(cenario.app)
      .post('/orcamentos')
      .set('Authorization', operador.autorizacao)
      .send({
        idCliente: cliente?.id_cliente,
        numeroSolicitacaoCompra: null,
        contatoSolicitacao: null,
      });
    const id = orcamento.idOrcamento as number;
    const adicionar = () =>
      request(cenario.app)
        .post(`/orcamentos/${id}/itens`)
        .set('Authorization', operador.autorizacao)
        .set('Idempotency-Key', 'chave-1')
        .send({ idVariacao, granularidade: 'AVULSO', quantidade: 3 });

    const primeira = await adicionar();
    const repetida = await adicionar();

    expect(repetida.status).toBe(primeira.status);
    expect(repetida.body).toEqual(primeira.body);
    const { body: detalhe } = await request(cenario.app)
      .get(`/orcamentos/${id}`)
      .set('Authorization', operador.autorizacao);
    expect(detalhe.itens).toHaveLength(1);
    expect(detalhe.itens[0].quantidade).toBe(3);
  });
});
