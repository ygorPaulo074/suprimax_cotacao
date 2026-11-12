// Teste de ponta a ponta (tasks #28/#29): o fluxo completo UC10 → UC14 → UC15-19 pelas rotas
// HTTP, com os módulos de pedidos e orçamentos ligados como em produção (via `app.ts`), e não por
// chamada direta ao serviço. Cobre o caminho que nenhum teste de um módulo isolado exercita: a
// montagem real do orçamento a partir do pedido, com preço calculado de verdade.
import request from 'supertest';
import { montarCenarioDeCadastros } from '../testing/cenarioDeCadastros';

async function montarCenario(quantidadeEstoque = 500) {
  const cenario = montarCenarioDeCadastros();
  const operador = await cenario.entrarComo('OPERADOR');
  const idVendedor = cenario.semearUsuario('VENDEDOR', 'vera');
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: '11222333000181',
    razao_social: 'Mercado Bom Preço',
    nome_contato: 'João',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: 'PROD-1',
    descricao: 'Papel Higiênico',
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaX',
    tamanho_embalagem: '30m',
    quantidade_estoque: quantidadeEstoque,
  });
  cenario.banco.semear('faixa_preco', {
    id_variacao: variacao?.id_variacao,
    quantidade_minima: 1,
    preco_unitario: '6.00',
  });
  const [pedido] = cenario.banco.semear('pedido', {
    id_cliente: cliente?.id_cliente,
    id_operador_vendedor: idVendedor,
    status: 'SOLICITADO',
  });
  cenario.banco.semear('item_pedido', {
    id_pedido: pedido?.id_pedido,
    id_variacao: variacao?.id_variacao,
    granularidade: 'AVULSO',
    id_fardo: null,
    quantidade_solicitada: 100,
  });
  return { ...cenario, operador, idPedido: pedido?.id_pedido as number };
}

describe('fluxo completo: pedido (UC10) → orçamento (UC14) → emissão (UC19)', () => {
  it('assume o pedido, monta o orçamento, grava as condições e emite, aprovando o pedido de origem', async () => {
    const { app, operador, idPedido, banco } = await montarCenario();
    const cabecalho = { Authorization: operador.autorizacao };

    const assumido = await request(app).post(`/pedidos/${idPedido}/assumir`).set(cabecalho);
    expect(assumido.status).toBe(200);
    expect(assumido.body.status).toBe('EM_ANALISE');

    const montado = await request(app).post(`/pedidos/${idPedido}/montar-orcamento`).set(cabecalho);
    expect(montado.status).toBe(201);
    const idOrcamento = montado.body.idOrcamento as number;

    const rascunho = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalho);
    expect(rascunho.body.status).toBe('RASCUNHO');
    // 100 un × R$6,00 = 60000 centavos de linha; 18% de imposto = 10800; total = 70800.
    expect(rascunho.body.condicoes.valorTotalItens).toBe(70800);
    expect(rascunho.body.condicoes.bloqueios).toEqual([]);

    const condicoes = await request(app)
      .put(`/orcamentos/${idOrcamento}/condicoes`)
      .set(cabecalho)
      .send({ condicaoPagamento: 'ADIANTADO_100', origemTransportadora: 'SUPRIMAX' });
    expect(condicoes.status).toBe(200);
    expect(condicoes.body.condicoes.bloqueios).toEqual([]);

    const emitido = await request(app).post(`/orcamentos/${idOrcamento}/emitir`).set(cabecalho);
    expect(emitido.status).toBe(200);
    expect(emitido.body.status).toBe('ABERTO');
    expect(emitido.body.numeroOrcamento).not.toBeNull();
    expect(emitido.body.chaveSeguranca).not.toBeNull();

    const pedidoFinal = banco.linhas('pedido').find((linha) => linha.id_pedido === idPedido);
    expect(pedidoFinal?.status).toBe('APROVADO');
    const reservas = banco.linhas('reserva_estoque');
    expect(reservas).toHaveLength(1);
    expect(reservas[0]).toMatchObject({ quantidade_reservada: 100, status: 'CONFIRMADA' });

    const detalheFinal = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalho);
    expect(detalheFinal.body.historico).toEqual([
      expect.objectContaining({ statusAnterior: null, statusNovo: 'RASCUNHO' }),
      expect.objectContaining({ statusAnterior: 'RASCUNHO', statusNovo: 'ABERTO' }),
    ]);
  });

  it('recusa montar o orçamento quando o estoque não cobre a quantidade do pedido (RN17)', async () => {
    const { app, operador, idPedido, banco } = await montarCenario(5);
    const cabecalho = { Authorization: operador.autorizacao };

    await request(app).post(`/pedidos/${idPedido}/assumir`).set(cabecalho);
    const montado = await request(app).post(`/pedidos/${idPedido}/montar-orcamento`).set(cabecalho);

    // A quantidade pedida (100) excede o saldo disponível (5): o item não é inserido.
    expect(montado.status).toBe(422);
    expect(montado.body.codigo).toBe('ESTOQUE_INDISPONIVEL');
    expect(banco.linhas('orcamento')).toHaveLength(1);
    expect(banco.linhas('item_orcamento')).toEqual([]);
  });
});
