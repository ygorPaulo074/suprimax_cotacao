// UC19 — testes de rota dos anexos de orçamento (upload multipart e remoção). As demais rotas de
// orçamentos já são exercitadas via `servico.test.ts`; este arquivo cobre apenas o que só existe
// no nível HTTP: o middleware do multer e a validação do multipart.
import request from 'supertest';
import { ErroDeEnvioDeEmail, type EnviadorDeEmail } from '../../email/enviador';
import {
  montarCenarioDeCadastros,
  type CenarioDeCadastros,
} from '../../testing/cenarioDeCadastros';

let contador = 0;

function semearCliente(cenario: CenarioDeCadastros): number {
  contador += 1;
  const idVendedor = cenario.semearUsuario('VENDEDOR', `vendedor-anexo-${contador}`);
  const [cliente] = cenario.banco.semear('cliente', {
    cnpj: String(40000000000000 + contador).padStart(14, '0'),
    razao_social: `Cliente Anexo ${contador}`,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: new Date().toISOString(),
  });
  return cliente?.id_cliente as number;
}

/** Semeia um produto com uma variação e uma faixa de preço (AVULSO), para emitir o orçamento. */
function semearVariacao(cenario: CenarioDeCadastros): number {
  contador += 1;
  const [produto] = cenario.banco.semear('produto', {
    codigo_interno: `PROD-ANEXO-${contador}`,
    descricao: 'Papel Higiênico',
  });
  const [variacao] = cenario.banco.semear('variacao_produto', {
    id_produto: produto?.id_produto,
    marca: 'MarcaX',
    tamanho_embalagem: '30m',
    quantidade_estoque: 1000,
  });
  const idVariacao = variacao?.id_variacao as number;
  cenario.banco.semear('faixa_preco', {
    id_variacao: idVariacao,
    quantidade_minima: 1,
    preco_unitario: '6.00',
  });
  return idVariacao;
}

async function montar(enviadorDeEmail?: EnviadorDeEmail) {
  const cenario = montarCenarioDeCadastros({ enviadorDeEmail });
  const operador = await cenario.entrarComo('OPERADOR');
  const idCliente = semearCliente(cenario);
  const { body: orcamento } = await request(cenario.app)
    .post('/orcamentos')
    .set('Authorization', operador.autorizacao)
    .send({ idCliente, numeroSolicitacaoCompra: null, contatoSolicitacao: null });
  const idOrcamento = orcamento.idOrcamento as number;
  const anexar = (
    tipoAnexo: string,
    conteudo: string | Buffer,
    nomeArquivo: string,
    autorizacao = operador.autorizacao,
  ) =>
    request(cenario.app)
      .post(`/orcamentos/${idOrcamento}/anexos`)
      .set('Authorization', autorizacao)
      .field('tipoAnexo', tipoAnexo)
      .attach('arquivo', Buffer.from(conteudo), nomeArquivo);
  const remover = (idAnexo: number, autorizacao = operador.autorizacao) =>
    request(cenario.app)
      .delete(`/orcamentos/${idOrcamento}/anexos/${idAnexo}`)
      .set('Authorization', autorizacao);
  const baixarAnexo = (idAnexo: number, autorizacao = operador.autorizacao) =>
    request(cenario.app)
      .get(`/orcamentos/${idOrcamento}/anexos/${idAnexo}`)
      .set('Authorization', autorizacao);
  const baixarPdf = (id: number = idOrcamento, autorizacao = operador.autorizacao) =>
    request(cenario.app).get(`/orcamentos/${id}/pdf`).set('Authorization', autorizacao);
  const enviarOrcamento = (id: number = idOrcamento, autorizacao = operador.autorizacao) =>
    request(cenario.app).post(`/orcamentos/${id}/enviar`).set('Authorization', autorizacao);
  const emitir = async () => {
    const idVariacao = semearVariacao(cenario);
    await request(cenario.app)
      .post(`/orcamentos/${idOrcamento}/itens`)
      .set('Authorization', operador.autorizacao)
      .send({ idVariacao, granularidade: 'AVULSO', quantidade: 1 });
    await request(cenario.app)
      .put(`/orcamentos/${idOrcamento}/condicoes`)
      .set('Authorization', operador.autorizacao)
      .send({
        condicaoPagamento: 'ADIANTADO_100',
        origemTransportadora: 'SUPRIMAX',
        valorFrete: 2000,
      });
    await request(cenario.app)
      .post(`/orcamentos/${idOrcamento}/emitir`)
      .set('Authorization', operador.autorizacao);
  };
  return {
    ...cenario,
    operador,
    idOrcamento,
    anexar,
    remover,
    baixarAnexo,
    baixarPdf,
    enviarOrcamento,
    emitir,
  };
}

describe('POST /orcamentos/:id/anexos (UC19)', () => {
  it('responde 200 com o anexo na lista, sem caminhoArquivo/tamanhoBytes', async () => {
    const { anexar } = await montar();

    const resposta = await anexar('DESCRITIVO_TECNICO', 'conteúdo do arquivo', 'ficha.pdf');

    expect(resposta.status).toBe(200);
    expect(resposta.body.anexos).toEqual([
      expect.objectContaining({ tipoAnexo: 'DESCRITIVO_TECNICO', nomeArquivo: 'ficha.pdf' }),
    ]);
    expect(resposta.body.anexos[0]).not.toHaveProperty('caminhoArquivo');
    expect(resposta.body.anexos[0]).not.toHaveProperty('tamanhoBytes');
  });

  it('responde 400 VALIDATION_ERROR sem o campo "arquivo"', async () => {
    const { operador, idOrcamento, app } = await montar();

    const resposta = await request(app)
      .post(`/orcamentos/${idOrcamento}/anexos`)
      .set('Authorization', operador.autorizacao)
      .field('tipoAnexo', 'DESCRITIVO_TECNICO');

    expect(resposta.status).toBe(400);
    expect(resposta.body.codigo).toBe('VALIDATION_ERROR');
  });

  it('responde 400 VALIDATION_ERROR com um tipoAnexo inválido', async () => {
    const { operador, idOrcamento, app } = await montar();

    const resposta = await request(app)
      .post(`/orcamentos/${idOrcamento}/anexos`)
      .set('Authorization', operador.autorizacao)
      .field('tipoAnexo', 'TIPO_INEXISTENTE')
      .attach('arquivo', Buffer.from('x'), 'arquivo.pdf');

    expect(resposta.status).toBe(400);
    expect(resposta.body.codigo).toBe('VALIDATION_ERROR');
  });

  it('responde 413 PAYLOAD_TOO_LARGE quando o arquivo excede o limite', async () => {
    const { anexar } = await montar();
    const arquivoGrande = Buffer.alloc(11 * 1024 * 1024, 'a'); // acima dos 10 MB permitidos

    const resposta = await anexar('DESCRITIVO_TECNICO', arquivoGrande, 'grande.pdf');

    expect(resposta.status).toBe(413);
    expect(resposta.body.codigo).toBe('PAYLOAD_TOO_LARGE');
  });

  it('responde 403 para quem não é OPERADOR/OPERADOR_CHEFE', async () => {
    const { anexar, entrarComo } = await montar();
    const financeiro = await entrarComo('FINANCEIRO');

    const resposta = await anexar(
      'DESCRITIVO_TECNICO',
      'conteúdo',
      'ficha.pdf',
      financeiro.autorizacao,
    );

    expect(resposta.status).toBe(403);
  });
});

describe('DELETE /orcamentos/:id/anexos/:idAnexo (UC19)', () => {
  it('remove o anexo e ele some da lista', async () => {
    const { anexar, remover } = await montar();
    const { body: comAnexo } = await anexar('MATERIAL_APOIO', 'conteúdo', 'catalogo.pdf');
    const idAnexo = comAnexo.anexos[0].idAnexo as number;

    const resposta = await remover(idAnexo);

    expect(resposta.status).toBe(200);
    expect(resposta.body.anexos).toEqual([]);
  });

  it('responde 404 para um anexo que não existe neste orçamento', async () => {
    const { remover } = await montar();

    const resposta = await remover(999);

    expect(resposta.status).toBe(404);
  });
});

describe('armazenamento dos anexos (UC19, RF11)', () => {
  it('guarda os bytes enviados e grava o caminho devolvido pelo armazenamento', async () => {
    const { anexar, armazenamento, banco } = await montar();

    const resposta = await anexar('DESCRITIVO_TECNICO', 'bytes do arquivo', 'ficha.pdf');

    expect(resposta.status).toBe(200);
    const [linha] = banco.linhas('anexo_orcamento');
    const objeto = armazenamento.objetos.get(linha?.caminho_arquivo as string);
    expect(objeto?.conteudo.toString()).toBe('bytes do arquivo');
    expect(JSON.stringify(resposta.body)).not.toContain(linha?.caminho_arquivo as string);
  });

  it('responde 503 e não grava a linha se o armazenamento estiver fora do ar', async () => {
    const { anexar, armazenamento, banco } = await montar();
    armazenamento.falharAoSalvar = true;

    const resposta = await anexar('DESCRITIVO_TECNICO', 'bytes', 'ficha.pdf');

    expect(resposta.status).toBe(503);
    expect(banco.linhas('anexo_orcamento')).toEqual([]);
  });

  it('remove o objeto ao remover o anexo', async () => {
    const { anexar, remover, armazenamento } = await montar();
    const { body } = await anexar('MATERIAL_APOIO', 'bytes', 'catalogo.pdf');

    await remover(body.anexos[0].idAnexo as number);

    expect(armazenamento.objetos.size).toBe(0);
  });
});

describe('GET /orcamentos/:id/anexos/:idAnexo (UC19, RF11)', () => {
  it('responde 200 com a URL assinada e a expiração, sem expor o caminho', async () => {
    const { anexar, baixarAnexo, banco } = await montar();
    const { body } = await anexar('DESCRITIVO_TECNICO', 'bytes', 'ficha.pdf');

    const resposta = await baixarAnexo(body.anexos[0].idAnexo as number);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({
      url: expect.stringContaining('https://'),
      expiraEm: expect.any(String),
    });
    const [linha] = banco.linhas('anexo_orcamento');
    expect(Object.keys(resposta.body)).toEqual(['url', 'expiraEm']);
    expect(linha?.caminho_arquivo).toEqual(expect.any(String));
  });

  it('responde 404 para um anexo que não é deste orçamento', async () => {
    const { baixarAnexo } = await montar();

    const resposta = await baixarAnexo(999);

    expect(resposta.status).toBe(404);
    expect(resposta.body.codigo).toBe('ANEXO_NAO_ENCONTRADO');
  });

  it('responde 403 para quem não é OPERADOR/OPERADOR_CHEFE', async () => {
    const { anexar, baixarAnexo, entrarComo } = await montar();
    const { body } = await anexar('DESCRITIVO_TECNICO', 'bytes', 'ficha.pdf');
    const financeiro = await entrarComo('FINANCEIRO');

    const resposta = await baixarAnexo(body.anexos[0].idAnexo as number, financeiro.autorizacao);

    expect(resposta.status).toBe(403);
  });
});

describe('GET /orcamentos/:id/pdf (UC19, docs/09)', () => {
  it('responde 200 com um PDF binário para um orçamento emitido', async () => {
    const { emitir, baixarPdf } = await montar();
    await emitir();

    const resposta = await baixarPdf();

    expect(resposta.status).toBe(200);
    expect(resposta.headers['content-type']).toBe('application/pdf');
    expect(resposta.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('responde 422 PDF_INDISPONIVEL para um orçamento ainda em RASCUNHO', async () => {
    const { baixarPdf } = await montar();

    const resposta = await baixarPdf();

    expect(resposta.status).toBe(422);
    expect(resposta.body.codigo).toBe('PDF_INDISPONIVEL');
  });

  it('responde 404 para um orçamento inexistente', async () => {
    const { baixarPdf } = await montar();

    const resposta = await baixarPdf(999);

    expect(resposta.status).toBe(404);
  });
});

describe('POST /orcamentos/:id/enviar (UC08)', () => {
  it('responde 204 para um orçamento emitido', async () => {
    const { emitir, enviarOrcamento } = await montar();
    await emitir();

    const resposta = await enviarOrcamento();

    expect(resposta.status).toBe(204);
    expect(resposta.body).toEqual({});
  });

  it('responde 503 SERVICO_INDISPONIVEL se o provedor de e-mail falhar, sem gravar o evento', async () => {
    const { emitir, enviarOrcamento, app, idOrcamento, operador } = await montar({
      enviar: () => Promise.reject(new ErroDeEnvioDeEmail('Resend indisponível.', 500)),
    });
    await emitir();

    const resposta = await enviarOrcamento();

    expect(resposta.status).toBe(503);
    expect(resposta.body.codigo).toBe('SERVICO_INDISPONIVEL');
    const detalhe = await request(app)
      .get(`/orcamentos/${idOrcamento}`)
      .set('Authorization', operador.autorizacao);
    expect(JSON.stringify(detalhe.body.historico)).not.toContain('ATUALIZACAO_FOLLOWUP');
  });

  it('responde 422 ENVIO_NAO_PERMITIDO para um orçamento ainda em RASCUNHO', async () => {
    const { enviarOrcamento } = await montar();

    const resposta = await enviarOrcamento();

    expect(resposta.status).toBe(422);
    expect(resposta.body.codigo).toBe('ENVIO_NAO_PERMITIDO');
  });

  it('responde 404 para um orçamento inexistente', async () => {
    const { enviarOrcamento } = await montar();

    const resposta = await enviarOrcamento(999);

    expect(resposta.status).toBe(404);
  });
});
