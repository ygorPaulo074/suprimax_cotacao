// UC24 — testes de rota do módulo de estoque (consulta, histórico e ajuste).
import request from 'supertest';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';

let contador = 0;

function semearVariacao(cenario: CenarioDeCadastros, quantidadeEstoque = 100): number {
  contador += 1;
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-ESTQ-${contador}`,
    descricao: `Produto Estoque ${contador}`,
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaEstoque',
    tamanho_embalagem: '1kg',
    quantidade_estoque: quantidadeEstoque,
  });
  return variacao?.id_variacao as number;
}

async function montar() {
  const cenario = montarCenarioDeCadastros();
  const chefe = await cenario.entrarComo('OPERADOR_CHEFE');
  const idVariacao = semearVariacao(cenario, 100);
  const obterSaldo = (id = idVariacao, autorizacao = chefe.autorizacao) =>
    request(cenario.app).get(`/estoque/variacoes/${id}`).set('Authorization', autorizacao);
  const listarSaldo = (q?: string, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .get('/estoque/variacoes')
      .query(q === undefined ? {} : { q })
      .set('Authorization', autorizacao);
  const listarMovimentacoes = (id = idVariacao, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .get(`/estoque/variacoes/${id}/movimentacoes`)
      .set('Authorization', autorizacao);
  const ajustar = (corpo: unknown, id = idVariacao, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .post(`/estoque/variacoes/${id}/ajustes`)
      .set('Authorization', autorizacao)
      .send(corpo as object);
  return { ...cenario, chefe, idVariacao, obterSaldo, listarSaldo, listarMovimentacoes, ajustar };
}

describe('GET /estoque/variacoes/:id (UC24)', () => {
  it('devolve o saldo da variação', async () => {
    const { obterSaldo } = await montar();

    const resposta = await obterSaldo();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      marca: 'MarcaEstoque',
      saldoFisico: 100,
      reservado: 0,
      disponivel: 100,
    });
  });

  it('responde 404 para variação inexistente', async () => {
    const { obterSaldo } = await montar();

    const resposta = await obterSaldo(999);

    expect(resposta.status).toBe(404);
  });

  it('responde 403 para quem não é operador chefe', async () => {
    const { obterSaldo, entrarComo } = await montar();
    const operador = await entrarComo('OPERADOR');

    const resposta = await obterSaldo(undefined, operador.autorizacao);

    expect(resposta.status).toBe(403);
  });
});

describe('GET /estoque/variacoes (UC24)', () => {
  it('lista as variações que batem com a marca buscada', async () => {
    const { listarSaldo } = await montar();

    const resposta = await listarSaldo('MarcaEstoque');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveLength(1);
  });

  it('não encontra nada com um termo que não bate', async () => {
    const { listarSaldo } = await montar();

    const resposta = await listarSaldo('Inexistente');

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveLength(0);
  });
});

describe('POST /estoque/variacoes/:id/ajustes (UC24)', () => {
  it('soma a quantidade e registra a movimentação AJUSTE', async () => {
    const { ajustar, obterSaldo, banco, idVariacao } = await montar();

    const resposta = await ajustar({ quantidade: 20, motivo: 'Contagem de inventário' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.saldoFisico).toBe(120);
    expect((await obterSaldo()).body.saldoFisico).toBe(120);
    expect(banco.linhas('movimentacao_estoque')).toEqual([
      expect.objectContaining({ id_variacao: idVariacao, tipo: 'AJUSTE', quantidade: 20 }),
    ]);
  });

  it('subtrai quando a quantidade é negativa', async () => {
    const { ajustar } = await montar();

    const resposta = await ajustar({ quantidade: -30, motivo: 'Avaria' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.saldoFisico).toBe(70);
  });

  it('responde 422 quando o ajuste deixaria o saldo abaixo do reservado', async () => {
    const { ajustar, idVariacao, banco, chefe } = await montar();
    const [cliente] = banco.semear('cliente', {
      cnpj: '55666777000100',
      razao_social: 'Cliente Reserva',
      nome_contato: 'Contato',
      tipo_unidade: 'MATRIZ',
      id_operador_vendedor: chefe.idOperador,
      aceite_lgpd: true,
      data_aceite_lgpd: new Date().toISOString(),
    });
    const [orcamento] = banco.semear('orcamento', {
      id_cliente: cliente?.id_cliente,
      id_operador: chefe.idOperador,
    });
    const [item] = banco.semear('item_orcamento', {
      id_orcamento: orcamento?.id_orcamento,
      id_variacao: idVariacao,
      granularidade: 'AVULSO',
      quantidade_avulsa: 90,
      preco_unitario_aplicado: '6.00',
      valor_imposto: '0.00',
      valor_total_item: '540.00',
      aprovacao_herdada: false,
    });
    banco.semear('reserva_estoque', {
      id_item: item?.id_item,
      quantidade_reservada: 90,
      data_expiracao: new Date('2099-01-01').toISOString(),
    });

    const resposta = await ajustar({ quantidade: -50, motivo: 'Avaria grande' });

    expect(resposta.status).toBe(422);
    expect(resposta.body.codigo).toBe('AJUSTE_ABAIXO_DO_RESERVADO');
  });

  it('responde 422 de validação quando o motivo está em branco', async () => {
    const { ajustar } = await montar();

    const resposta = await ajustar({ quantidade: 10, motivo: '' });

    expect(resposta.status).toBe(400);
  });
});

describe('GET /estoque/variacoes/:id/movimentacoes (UC24)', () => {
  it('lista as movimentações, mais recente primeiro, com o nome do operador', async () => {
    const { ajustar, listarMovimentacoes } = await montar();
    await ajustar({ quantidade: 5, motivo: 'Primeiro ajuste' });
    await ajustar({ quantidade: -2, motivo: 'Segundo ajuste' });

    const resposta = await listarMovimentacoes();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toHaveLength(2);
    expect(resposta.body[0]).toMatchObject({ quantidade: -2, motivo: 'Segundo ajuste' });
    expect(resposta.body[0].usuario).toMatch(/operador_chefe/i);
  });
});
