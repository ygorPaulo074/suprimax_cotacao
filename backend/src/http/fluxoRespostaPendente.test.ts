// Teste de ponta a ponta (item 7 do backend/TAREFAS.md): as rotas de UC21 (`/respostas-pendentes`)
// pelas rotas HTTP reais, com o módulo de respostas ligado como em produção (via `app.ts`), e não
// por chamada direta ao serviço. O processamento automático da resposta (UC20) não tem rota HTTP
// nesta entrega (fica para o job do item 9 do TAREFAS.md) — por isso a resposta é semeada direto
// no banco já em AGUARDA_OPERADOR, como o UC20 a deixaria; o que este teste cobre é a montagem
// real do módulo de respostas e a delegação para `ServicoDeOrcamentos` (nova versão, substituição).
import request from 'supertest';
import { montarCenarioDeCadastros } from '../testing/cenarioDeCadastros';

async function montarCenario() {
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
    quantidade_estoque: 1000,
  });
  cenario.banco.semear('faixa_preco', {
    id_variacao: variacao?.id_variacao,
    quantidade_minima: 1,
    preco_unitario: '6.00',
  });
  const cabecalho = { Authorization: operador.autorizacao };

  const criado = await request(cenario.app).post('/orcamentos').set(cabecalho).send({
    idCliente: cliente?.id_cliente,
    numeroSolicitacaoCompra: null,
    contatoSolicitacao: null,
  });
  const idOrcamento = criado.body.idOrcamento as number;
  const comItem = await request(cenario.app)
    .post(`/orcamentos/${idOrcamento}/itens`)
    .set(cabecalho)
    .send({ idVariacao: variacao?.id_variacao, granularidade: 'AVULSO', quantidade: 300 });
  const idItem = comItem.body.itens[0].idItem as number;
  await request(cenario.app).post(`/orcamentos/${idOrcamento}/emitir`).set(cabecalho);

  // Resposta já em AGUARDA_OPERADOR, como o UC20 a deixaria para um item não aprovado.
  const [resposta] = cenario.banco.semear('resposta_orcamento', {
    id_orcamento: idOrcamento,
    tipo_resposta: 'ITENS',
    status_resposta: 'AGUARDA_OPERADOR',
    motivo_tratamento: 'ITENS_NAO_APROVADOS',
    id_operador_vendedor: idVendedor,
    data_resposta: new Date().toISOString(),
  });
  const idResposta = resposta?.id_resposta as number;
  cenario.banco.semear('item_resposta_orcamento', {
    id_resposta: idResposta,
    id_item: idItem,
    quantidade_aprovada: 0,
    situacao: 'NAO_APROVADO',
  });

  return { ...cenario, cabecalho, idOrcamento, idResposta };
}

describe('fluxo completo: UC21 — respostas pendentes pelas rotas HTTP', () => {
  it('lista, conta, abre o tratamento e emite a nova versão, substituindo o original', async () => {
    const { app, cabecalho, idOrcamento, idResposta, banco } = await montarCenario();

    const lista = await request(app).get('/respostas-pendentes').set(cabecalho);
    expect(lista.status).toBe(200);
    expect(lista.body).toEqual([
      expect.objectContaining({ idResposta, tipo: 'ITENS_NAO_APROVADOS' }),
    ]);

    const contador = await request(app).get('/respostas-pendentes/contador').set(cabecalho);
    expect(contador.body).toEqual({ total: 1 });

    const detalhe = await request(app).get(`/respostas-pendentes/${idResposta}`).set(cabecalho);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.novaVersao.status).toBe('RASCUNHO');
    expect(detalhe.body.novaVersao.idOrcamento).not.toBe(idOrcamento);

    const emitida = await request(app)
      .post(`/respostas-pendentes/${idResposta}/emitir-nova-versao`)
      .set(cabecalho);
    expect(emitida.status).toBe(200);
    const idNovaVersao = emitida.body.idOrcamento as number;

    const original = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalho);
    expect(original.body.status).toBe('SUBSTITUIDO');
    const novaVersao = await request(app).get(`/orcamentos/${idNovaVersao}`).set(cabecalho);
    expect(novaVersao.body.status).toBe('ABERTO');
    expect(novaVersao.body.numeroOrcamento).not.toBeNull();

    const respostaFinal = banco
      .linhas('resposta_orcamento')
      .find((linha) => linha.id_resposta === idResposta);
    expect(respostaFinal?.status_resposta).toBe('TRATADA');
  });

  it('descarta o rascunho (UC21-A2): a resposta continua aguardando tratamento', async () => {
    const { app, cabecalho, idOrcamento, idResposta, banco } = await montarCenario();

    const detalhe = await request(app).get(`/respostas-pendentes/${idResposta}`).set(cabecalho);
    const idRascunho = detalhe.body.novaVersao.idOrcamento as number;

    const descartado = await request(app)
      .delete(`/respostas-pendentes/${idResposta}/rascunho`)
      .set(cabecalho);
    expect(descartado.status).toBe(204);

    const rascunho = banco.linhas('orcamento').find((linha) => linha.id_orcamento === idRascunho);
    expect(rascunho?.status).toBe('CANCELADO');
    const respostaFinal = banco
      .linhas('resposta_orcamento')
      .find((linha) => linha.id_resposta === idResposta);
    expect(respostaFinal?.status_resposta).toBe('AGUARDA_OPERADOR');
    const original = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalho);
    expect(original.body.status).toBe('ABERTO');
  });

  it('trata sem nova versão (UC21-A1): a resposta vira TRATADA sem tocar no orçamento', async () => {
    const { app, cabecalho, idOrcamento, idResposta, banco } = await montarCenario();

    const tratada = await request(app)
      .post(`/respostas-pendentes/${idResposta}/tratar-sem-nova-versao`)
      .set(cabecalho);
    expect(tratada.status).toBe(204);

    const respostaFinal = banco
      .linhas('resposta_orcamento')
      .find((linha) => linha.id_resposta === idResposta);
    expect(respostaFinal?.status_resposta).toBe('TRATADA');
    const original = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalho);
    expect(original.body.status).toBe('ABERTO');
  });
});
