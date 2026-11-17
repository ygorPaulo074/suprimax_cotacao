// UC07 — teste de ponta a ponta pelas rotas HTTP reais: o orçamento entra em PENDENTE_CREDITO ao
// pedir uma condição a prazo sem análise concluída (UC18), a análise é aberta automaticamente, o
// fiscal lista, marca documentos e registra o resultado, e o orçamento volta a RASCUNHO (UC07).
import request from 'supertest';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';
import { RepositorioDeAnalisesDeCredito } from './repositorio';

async function montarCenario() {
  const cenario = montarCenarioDeCadastros();
  const operador = await cenario.entrarComo('OPERADOR');
  const fiscal = await cenario.entrarComo('FISCAL');
  const idVendedor = cenario.semearUsuario('VENDEDOR', 'vera-credito');
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: '22333444000155',
    razao_social: 'Distribuidora Boa Fé',
    nome_contato: 'Marcos',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  const idCliente = cliente?.id_cliente as number;
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: 'PROD-CREDITO-1',
    descricao: 'Detergente Concentrado',
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaCredito',
    tamanho_embalagem: '5L',
    quantidade_estoque: 1000,
  });
  const idVariacao = variacao?.id_variacao as number;
  cenario.banco.semear('faixa_preco', {
    id_variacao: idVariacao,
    quantidade_minima: 1,
    preco_unitario: '600.00',
  });
  const cabecalhoOperador = { Authorization: operador.autorizacao };
  const cabecalhoFiscal = { Authorization: fiscal.autorizacao };

  // Uma compra já aceita antes, só para o cliente deixar de ser "primeira compra" (RN06 força
  // ADIANTADO_100 na primeira compra, o que nunca exigiria análise de crédito).
  cenario.banco.semear('orcamento', {
    id_cliente: idCliente,
    id_operador: operador.idOperador,
    status: 'ACEITO',
  });

  const criado = await request(cenario.app)
    .post('/orcamentos')
    .set(cabecalhoOperador)
    .send({ idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null });
  const idOrcamento = criado.body.idOrcamento as number;
  await request(cenario.app)
    .post(`/orcamentos/${idOrcamento}/itens`)
    .set(cabecalhoOperador)
    .send({ idVariacao, granularidade: 'AVULSO', quantidade: 1 });

  return {
    ...cenario,
    cabecalhoOperador,
    cabecalhoFiscal,
    idCliente,
    idOrcamento,
    pedirBoleto: () =>
      request(cenario.app)
        .put(`/orcamentos/${idOrcamento}/condicoes`)
        .set(cabecalhoOperador)
        .send({ condicaoPagamento: 'BOLETO', prazoDias: 30, origemTransportadora: 'SUPRIMAX' }),
  };
}

describe('análise de crédito (UC07) — fluxo completo pelas rotas HTTP', () => {
  it('abre a análise ao pedir BOLETO sem resultado e lista para o fiscal', async () => {
    const { app, cabecalhoFiscal, pedirBoleto, idOrcamento, idCliente } = await montarCenario();

    const condicoes = await pedirBoleto();
    expect(condicoes.status).toBe(200);
    expect(condicoes.body.status).toBe('PENDENTE_CREDITO');

    const lista = await request(app).get('/analises-credito').set(cabecalhoFiscal);
    expect(lista.status).toBe(200);
    expect(lista.body).toEqual([
      expect.objectContaining({
        cliente: 'Distribuidora Boa Fé',
        cnpj: '22333444000155',
        numeroOrcamento: null,
        resultado: null,
      }),
    ]);

    // idOrcamento é interno (não é o número público, só atribuído na emissão) — confere que a
    // análise ficou mesmo vinculada a este orçamento via o detalhe.
    const idAnalise = lista.body[0].idAnalise as number;
    const detalhe = await request(app).get(`/analises-credito/${idAnalise}`).set(cabecalhoFiscal);
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.documentos).toHaveLength(6);
    expect(
      detalhe.body.documentos.every((documento: { recebido: boolean }) => !documento.recebido),
    ).toBe(true);
    expect(detalhe.body.valorCompra).toBe(70800);

    // Pedir de novo não abre uma segunda análise para o mesmo cliente (idempotente).
    await pedirBoleto();
    const listaDeNovo = await request(app).get('/analises-credito').set(cabecalhoFiscal);
    expect(listaDeNovo.body).toHaveLength(1);
    void idOrcamento;
    void idCliente;
  });

  it('marca um documento do checklist como recebido', async () => {
    const { app, cabecalhoFiscal, pedirBoleto } = await montarCenario();
    await pedirBoleto();
    const [analise] = (await request(app).get('/analises-credito').set(cabecalhoFiscal)).body;

    const resposta = await request(app)
      .post(`/analises-credito/${analise.idAnalise}/documentos`)
      .set(cabecalhoFiscal)
      .send({ tipoDocumento: 'CONTRATO_SOCIAL', dataRecebimento: '2026-01-10' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.documentos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoDocumento: 'CONTRATO_SOCIAL',
          recebido: true,
          dataRecebimento: '2026-01-10',
        }),
      ]),
    );
  });

  it('aprova a análise e devolve o orçamento a RASCUNHO', async () => {
    const { app, cabecalhoOperador, cabecalhoFiscal, pedirBoleto, idOrcamento } =
      await montarCenario();
    await pedirBoleto();
    const [analise] = (await request(app).get('/analises-credito').set(cabecalhoFiscal)).body;

    const resultado = await request(app)
      .post(`/analises-credito/${analise.idAnalise}/resultado`)
      .set(cabecalhoFiscal)
      .send({ resultado: 'APROVADO' });

    expect(resultado.status).toBe(200);
    expect(resultado.body.resultado).toBe('APROVADO');

    const orcamento = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalhoOperador);
    expect(orcamento.body.status).toBe('RASCUNHO');
  });

  it('reprova a análise, também devolvendo o orçamento a RASCUNHO', async () => {
    const { app, cabecalhoOperador, cabecalhoFiscal, pedirBoleto, idOrcamento } =
      await montarCenario();
    await pedirBoleto();
    const [analise] = (await request(app).get('/analises-credito').set(cabecalhoFiscal)).body;

    const resultado = await request(app)
      .post(`/analises-credito/${analise.idAnalise}/resultado`)
      .set(cabecalhoFiscal)
      .send({ resultado: 'REPROVADO' });

    expect(resultado.status).toBe(200);
    expect(resultado.body.resultado).toBe('REPROVADO');

    const orcamento = await request(app).get(`/orcamentos/${idOrcamento}`).set(cabecalhoOperador);
    expect(orcamento.body.status).toBe('RASCUNHO');
  });

  it('responde 409 ao tentar registrar o resultado de uma análise já concluída', async () => {
    const { app, cabecalhoFiscal, pedirBoleto } = await montarCenario();
    await pedirBoleto();
    const [analise] = (await request(app).get('/analises-credito').set(cabecalhoFiscal)).body;
    await request(app)
      .post(`/analises-credito/${analise.idAnalise}/resultado`)
      .set(cabecalhoFiscal)
      .send({ resultado: 'APROVADO' });

    const segunda = await request(app)
      .post(`/analises-credito/${analise.idAnalise}/resultado`)
      .set(cabecalhoFiscal)
      .send({ resultado: 'REPROVADO' });

    expect(segunda.status).toBe(409);
    expect(segunda.body.codigo).toBe('ANALISE_CREDITO_JA_CONCLUIDA');
  });

  it('responde 404 para uma análise inexistente', async () => {
    const { app, cabecalhoFiscal } = await montarCenario();

    const resposta = await request(app).get('/analises-credito/999999').set(cabecalhoFiscal);

    expect(resposta.status).toBe(404);
    expect(resposta.body.codigo).toBe('ANALISE_CREDITO_NAO_ENCONTRADA');
  });

  it('responde 403 quando quem não é fiscal tenta listar as análises', async () => {
    const { app, cabecalhoOperador } = await montarCenario();

    const resposta = await request(app).get('/analises-credito').set(cabecalhoOperador);

    expect(resposta.status).toBe(403);
  });
});

describe('documentos de crédito com arquivo digital (UC07, LGPD)', () => {
  async function comAnalise() {
    const cenario = await montarCenario();
    await cenario.pedirBoleto();
    const [analise] = (
      await request(cenario.app).get('/analises-credito').set(cenario.cabecalhoFiscal)
    ).body;
    const idAnalise = analise.idAnalise as number;
    const enviar = (
      conteudo = 'contrato social',
      nome = 'contrato.pdf',
      cabecalho = cenario.cabecalhoFiscal,
    ) =>
      request(cenario.app)
        .post(`/analises-credito/${idAnalise}/documentos`)
        .set(cabecalho)
        .field('tipoDocumento', 'CONTRATO_SOCIAL')
        .field('dataRecebimento', '2026-01-10')
        .attach('arquivo', Buffer.from(conteudo), nome);
    const baixar = (id = idAnalise, cabecalho = cenario.cabecalhoFiscal) =>
      request(cenario.app)
        .get(`/analises-credito/${id}/documentos/CONTRATO_SOCIAL/arquivo`)
        .set(cabecalho);
    return { ...cenario, idAnalise, enviar, baixar };
  }

  it('com arquivo: guarda o objeto, grava nome e caminho reais e não expõe o caminho', async () => {
    const { enviar, armazenamento, banco, linhas } = await comAnalise();

    const resposta = await enviar();

    expect(resposta.status).toBe(200);
    expect(resposta.body.documentos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tipoDocumento: 'CONTRATO_SOCIAL',
          recebido: true,
          temArquivo: true,
        }),
      ]),
    );
    const [linha] = banco.linhas('documento_analise_credito');
    expect(linha?.nome_arquivo).toBe('contrato.pdf');
    expect([...armazenamento.objetos.keys()]).toEqual([linha?.caminho_arquivo]);
    expect(String(linha?.caminho_arquivo)).toMatch(/^analise-credito\//);
    expect(JSON.stringify(resposta.body)).not.toContain('analise-credito/');
    expect(JSON.stringify(linhas)).not.toContain(String(linha?.caminho_arquivo));
  });

  it('sem arquivo: segue como documento físico, sem tocar no armazenamento', async () => {
    const { app, cabecalhoFiscal, idAnalise, armazenamento, baixar, banco } = await comAnalise();

    const resposta = await request(app)
      .post(`/analises-credito/${idAnalise}/documentos`)
      .set(cabecalhoFiscal)
      .send({ tipoDocumento: 'CONTRATO_SOCIAL', dataRecebimento: '2026-01-10' });

    expect(resposta.status).toBe(200);
    expect(resposta.body.documentos).toEqual(
      expect.arrayContaining([expect.objectContaining({ recebido: true, temArquivo: false })]),
    );
    expect(armazenamento.objetos.size).toBe(0);
    expect(banco.linhas('documento_analise_credito')[0]?.nome_arquivo).toBe(
      'recebido_sem_arquivo_digital',
    );
    const url = await baixar();
    expect(url.status).toBe(404);
    expect(url.body.codigo).toBe('DOCUMENTO_CREDITO_NAO_ENCONTRADO');
  });

  it('não grava a linha quando salvar o arquivo falha', async () => {
    const { enviar, armazenamento, banco } = await comAnalise();
    armazenamento.falharAoSalvar = true;

    const resposta = await enviar();

    expect(resposta.status).toBe(503);
    expect(banco.linhas('documento_analise_credito')).toEqual([]);
    expect(armazenamento.objetos.size).toBe(0);
  });

  it('remove o objeto quando gravar a linha falha (compensação)', async () => {
    const { enviar, armazenamento } = await comAnalise();
    const espiao = jest
      .spyOn(RepositorioDeAnalisesDeCredito.prototype, 'registrarDocumento')
      .mockRejectedValueOnce(new Error('banco fora'));

    const resposta = await enviar();
    espiao.mockRestore();

    expect(resposta.status).toBe(500);
    expect(armazenamento.objetos.size).toBe(0);
  });

  it('reenviar o documento substitui o arquivo e remove o objeto anterior', async () => {
    const { enviar, armazenamento, banco } = await comAnalise();

    await enviar('versao 1', 'v1.pdf');
    const resposta = await enviar('versao 2', 'v2.pdf');

    expect(resposta.status).toBe(200);
    expect(banco.linhas('documento_analise_credito')).toHaveLength(1);
    expect(banco.linhas('documento_analise_credito')[0]?.nome_arquivo).toBe('v2.pdf');
    expect(armazenamento.objetos.size).toBe(1);
  });

  it('GET devolve a URL assinada do arquivo, sem o caminho', async () => {
    const { enviar, baixar } = await comAnalise();
    await enviar();

    const resposta = await baixar();

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ url: expect.any(String), expiraEm: expect.any(String) });
  });

  it('GET responde 404 para documento de outra análise e para análise inexistente', async () => {
    const { enviar, baixar, banco, idCliente } = await comAnalise();
    await enviar();
    const [outra] = banco.semear('analise_credito', {
      id_cliente: idCliente,
      data_solicitacao: '2026-01-02',
    });

    const deOutra = await baixar(outra?.id_analise as number);
    const inexistente = await baixar(99999);

    expect(deOutra.status).toBe(404);
    expect(deOutra.body.codigo).toBe('DOCUMENTO_CREDITO_NAO_ENCONTRADO');
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.codigo).toBe('ANALISE_CREDITO_NAO_ENCONTRADA');
  });

  it('responde 403 a quem não é fiscal, no upload e no GET', async () => {
    const { enviar, baixar, cabecalhoOperador, armazenamento } = await comAnalise();

    expect((await enviar('x', 'a.pdf', cabecalhoOperador)).status).toBe(403);
    expect((await baixar(undefined, cabecalhoOperador)).status).toBe(403);
    expect(armazenamento.objetos.size).toBe(0);
  });

  it('responde 413 para arquivo acima de 10 MB', async () => {
    const { enviar, armazenamento } = await comAnalise();

    const resposta = await enviar('x'.repeat(10 * 1024 * 1024 + 1));

    expect(resposta.status).toBe(413);
    expect(armazenamento.objetos.size).toBe(0);
  });

  it.each([['contrato.pdf'], ['foto.jpg'], ['foto.png']])(
    'aceita o tipo de conteúdo de %s',
    async (nome) => {
      const { enviar, armazenamento } = await comAnalise();

      const resposta = await enviar('conteudo', nome);

      expect(resposta.status).toBe(200);
      expect(armazenamento.objetos.size).toBe(1);
    },
  );

  it('recusa tipo de conteúdo fora de PDF/JPEG/PNG com 422, sem enviar ao armazenamento', async () => {
    const { enviar, armazenamento } = await comAnalise();

    const resposta = await enviar('conteudo', 'planilha.txt');

    expect(resposta.status).toBe(422);
    expect(armazenamento.objetos.size).toBe(0);
  });

  it('aceita nome com 255 caracteres e recusa 256 com 422, sem enviar ao armazenamento', async () => {
    const { enviar, armazenamento } = await comAnalise();

    const aceito = await enviar('x', `${'a'.repeat(251)}.pdf`);
    expect(aceito.status).toBe(200);
    expect(armazenamento.objetos.size).toBe(1);

    const recusado = await enviar('x', `${'a'.repeat(252)}.pdf`);
    expect(recusado.status).toBe(422);
    expect(armazenamento.objetos.size).toBe(1);
  });
});
