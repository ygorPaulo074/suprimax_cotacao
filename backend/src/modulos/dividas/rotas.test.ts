// UC23 — testes de rota do módulo de dívidas (registro, renegociação e quitação).
import request from 'supertest';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';

let contador = 0;

function semearCliente(cenario: CenarioDeCadastros): number {
  contador += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-divida-${contador}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(30000000000000 + contador).padStart(14, '0'),
    razao_social: `Cliente Dívida ${contador}`,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  return cliente?.id_cliente as number;
}

async function montar() {
  const cenario = montarCenarioDeCadastros();
  const financeiro = await cenario.entrarComo('FINANCEIRO');
  const idCliente = semearCliente(cenario);
  const dividaNova = (alteracoes: Record<string, unknown> = {}) => ({
    idCliente,
    valorDivida: 100_000, // R$ 1.000,00
    dataVencimentoOriginal: '2026-01-10',
    ...alteracoes,
  });
  const registrar = (corpo: unknown, autorizacao = financeiro.autorizacao) =>
    request(cenario.app)
      .post('/dividas')
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const listar = (autorizacao = financeiro.autorizacao) =>
    request(cenario.app).get('/dividas').set('Authorization', autorizacao);
  const renegociar = (idDivida: number, corpo: unknown, autorizacao = financeiro.autorizacao) =>
    request(cenario.app)
      .post(`/dividas/${idDivida}/renegociar`)
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const quitar = (idDivida: number, autorizacao = financeiro.autorizacao) =>
    request(cenario.app).post(`/dividas/${idDivida}/quitar`).set('Authorization', autorizacao);
  return { ...cenario, financeiro, idCliente, dividaNova, registrar, listar, renegociar, quitar };
}

describe('POST /dividas (UC23)', () => {
  it('responde 201 e bloqueia o cliente (RN06)', async () => {
    const { registrar, dividaNova, banco, idCliente } = await montar();

    const resposta = await registrar(dividaNova());

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      idCliente,
      valorDivida: 100_000,
      status: 'EM_ABERTO',
      cliente: expect.stringContaining('Cliente Dívida'),
    });
    expect(banco.linhas('divida_inadimplencia')).toEqual([
      expect.objectContaining({ id_cliente: idCliente, status: 'EM_ABERTO' }),
    ]);
  });

  it('responde 403 para quem não é do perfil FINANCEIRO', async () => {
    const { registrar, dividaNova, entrarComo } = await montar();
    const operador = await entrarComo('OPERADOR');

    const resposta = await registrar(dividaNova(), operador.autorizacao);

    expect(resposta.status).toBe(403);
  });
});

describe('GET /dividas (UC23)', () => {
  it('lista as dívidas registradas', async () => {
    const { registrar, listar, dividaNova } = await montar();
    await registrar(dividaNova());

    const resposta = await listar();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveLength(1);
  });
});

describe('POST /dividas/:id/renegociar (UC23)', () => {
  it('aceita pagamento de 50% ou mais e marca RENEGOCIADA', async () => {
    const { registrar, renegociar, dividaNova } = await montar();
    const { body: divida } = await registrar(dividaNova({ valorDivida: 100_000 }));

    const resposta = await renegociar(divida.idDivida, {
      dataRenegociacao: '2026-02-01',
      valorPago: 50_000,
    });

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ status: 'RENEGOCIADA', valorPagoRenegociacao: 50_000 });
  });

  it('responde 422 RENEGOCIACAO_ABAIXO_DO_MINIMO quando o pagamento é menor que 50%', async () => {
    const { registrar, renegociar, dividaNova } = await montar();
    const { body: divida } = await registrar(dividaNova({ valorDivida: 100_000 }));

    const resposta = await renegociar(divida.idDivida, {
      dataRenegociacao: '2026-02-01',
      valorPago: 49_999,
    });

    expect(resposta.status).toBe(422);
    expect(resposta.body.codigo).toBe('RENEGOCIACAO_ABAIXO_DO_MINIMO');
  });

  it('arredonda o mínimo para cima quando a dívida tem valor ímpar (101 → 51)', async () => {
    const { registrar, renegociar, dividaNova } = await montar();
    const { body: divida } = await registrar(dividaNova({ valorDivida: 101 }));

    const abaixo = await renegociar(divida.idDivida, {
      dataRenegociacao: '2026-02-01',
      valorPago: 50,
    });
    expect(abaixo.status).toBe(422);
    expect(abaixo.body.codigo).toBe('RENEGOCIACAO_ABAIXO_DO_MINIMO');

    const noMinimo = await renegociar(divida.idDivida, {
      dataRenegociacao: '2026-02-01',
      valorPago: 51,
    });
    expect(noMinimo.status).toBe(200);
    expect(noMinimo.body).toMatchObject({ status: 'RENEGOCIADA', valorPagoRenegociacao: 51 });
  });

  it('responde 404 para dívida inexistente', async () => {
    const { renegociar } = await montar();

    const resposta = await renegociar(999, { dataRenegociacao: '2026-02-01', valorPago: 1 });

    expect(resposta.status).toBe(404);
  });

  it('responde 422 ao tentar renegociar uma dívida já renegociada', async () => {
    const { registrar, renegociar, dividaNova } = await montar();
    const { body: divida } = await registrar(dividaNova({ valorDivida: 100_000 }));
    await renegociar(divida.idDivida, { dataRenegociacao: '2026-02-01', valorPago: 50_000 });

    const resposta = await renegociar(divida.idDivida, {
      dataRenegociacao: '2026-02-02',
      valorPago: 100_000,
    });

    expect(resposta.status).toBe(422);
    expect(resposta.body.codigo).toBe('DIVIDA_NAO_RENEGOCIAVEL');
  });
});

describe('POST /dividas/:id/quitar (UC23)', () => {
  it('marca a dívida como QUITADA', async () => {
    const { registrar, quitar, dividaNova } = await montar();
    const { body: divida } = await registrar(dividaNova());

    const resposta = await quitar(divida.idDivida);

    expect(resposta.status).toBe(200);
    expect(resposta.body.status).toBe('QUITADA');
  });

  it('responde 422 ao quitar uma dívida já quitada', async () => {
    const { registrar, quitar, dividaNova } = await montar();
    const { body: divida } = await registrar(dividaNova());
    await quitar(divida.idDivida);

    const resposta = await quitar(divida.idDivida);

    expect(resposta.status).toBe(422);
  });
});
