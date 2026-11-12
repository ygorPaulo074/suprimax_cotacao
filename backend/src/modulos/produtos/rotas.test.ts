import request from 'supertest';
import { ErroInterno } from '../../erros';
import type { Linha } from '../../testing/bancoFalso';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';
import type { ChamadaAoProxy } from '../../testing/proxyClienteFalso';

const CHAMEX = {
  marca: 'Chamex',
  tamanhoEmbalagem: '500 folhas',
  quantidadeEstoque: 40,
  faixasPreco: [
    { quantidadeMinima: 1, precoUnitario: 2500 },
    { quantidadeMinima: 4, precoUnitario: 1900 },
  ],
  fardos: [{ quantidadeUnidades: 10, precoFixo: 17000 }],
};
const REPORT = {
  marca: 'Report',
  tamanhoEmbalagem: '500 folhas',
  faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 2399 }],
  fardos: [],
};

interface ProdutoDaResposta {
  idProduto: number;
  descricao: string;
  variacoes: {
    idVariacao: number;
    marca: string;
    tamanhoEmbalagem: string;
    faixasPreco: { idFaixaPreco: number; quantidadeMinima: number; precoUnitario: number }[];
    fardos: { idFardo: number; quantidadeUnidades: number; precoFixo: number }[];
  }[];
}

async function montar() {
  const cenario = montarCenarioDeCadastros();
  const chefe = await cenario.entrarComo('OPERADOR_CHEFE');
  const operador = await cenario.entrarComo('OPERADOR');
  const produtoNovo = (alteracoes: Record<string, unknown> = {}) => ({
    codigoInterno: 'PAP-001',
    descricao: 'Papel sulfite A4',
    ncm: '4802.56.10',
    ean: '7891234567895',
    categoria: 'Papelaria',
    ativo: true,
    variacoes: [CHAMEX, REPORT],
    ...alteracoes,
  });
  const criar = (corpo: unknown, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .post('/produtos')
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const alterar = (id: number | string, corpo: unknown, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .put(`/produtos/${id}`)
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const obter = (id: number | string, autorizacao = chefe.autorizacao) =>
    request(cenario.app).get(`/produtos/${id}`).set('Authorization', autorizacao);
  const listar = (q?: string, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .get('/produtos')
      .query(q === undefined ? {} : { q })
      .set('Authorization', autorizacao);
  /** Cria o produto padrão e devolve o corpo do PUT que o repete sem tocar nos preços. */
  const criarPadrao = async () => {
    const produto = (await criar(produtoNovo())).body as ProdutoDaResposta;
    const semPrecos = produtoNovo({
      variacoes: produto.variacoes.map(({ idVariacao, marca, tamanhoEmbalagem }) => ({
        idVariacao,
        marca,
        tamanhoEmbalagem,
      })),
    });
    return { produto, semPrecos };
  };
  const precos = (tabela: 'faixa_preco' | 'fardo') =>
    cenario.banco.linhas(tabela).map((linha): Linha => {
      const { id_variacao: idVariacao, ...demais } = linha;
      return { idVariacao, ...demais };
    });
  return {
    ...cenario,
    chefe,
    operador,
    produtoNovo,
    criar,
    alterar,
    obter,
    listar,
    criarPadrao,
    precos,
  };
}

describe('POST /produtos (UC04)', () => {
  it('responde 201 com o produto, as variações e os preços em centavos', async () => {
    const { criar, produtoNovo } = await montar();

    const resposta = await criar(produtoNovo());

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      idProduto: 1,
      codigoInterno: 'PAP-001',
      descricao: 'Papel sulfite A4',
      ncm: '48025610',
      ean: '7891234567895',
      categoria: 'Papelaria',
      ativo: true,
      variacoes: [
        {
          idVariacao: 1,
          marca: 'Chamex',
          tamanhoEmbalagem: '500 folhas',
          quantidadeEstoque: 40,
          saldoDisponivel: 40,
          faixasPreco: [
            { idFaixaPreco: 1, quantidadeMinima: 1, precoUnitario: 2500 },
            { idFaixaPreco: 2, quantidadeMinima: 4, precoUnitario: 1900 },
          ],
          fardos: [{ idFardo: 1, quantidadeUnidades: 10, precoFixo: 17000 }],
        },
        {
          idVariacao: 2,
          marca: 'Report',
          tamanhoEmbalagem: '500 folhas',
          quantidadeEstoque: 0,
          saldoDisponivel: 0,
          faixasPreco: [{ idFaixaPreco: 3, quantidadeMinima: 1, precoUnitario: 2399 }],
          fardos: [],
        },
      ],
    });
  });

  it('grava os preços como DECIMAL em texto, cada um na sua variação, em uma única transação', async () => {
    const { criar, produtoNovo, precos, proxy } = await montar();

    await criar(produtoNovo());

    expect(precos('faixa_preco')).toEqual([
      { id_faixa_preco: 1, idVariacao: 1, quantidade_minima: 1, preco_unitario: '25.00' },
      { id_faixa_preco: 2, idVariacao: 1, quantidade_minima: 4, preco_unitario: '19.00' },
      { id_faixa_preco: 3, idVariacao: 2, quantidade_minima: 1, preco_unitario: '23.99' },
    ]);
    expect(precos('fardo')).toEqual([
      { id_fardo: 1, idVariacao: 1, quantidade_unidades: 10, preco_fixo: '170.00' },
    ]);
    const [lote] = proxy.chamadasDe('dados.lote');
    expect(lote?.operationId).toBe('UC04-cadastrar-produto');
    expect(proxy.chamadasDe('dados.lote')).toHaveLength(1);
    expect(proxy.chamadasDe('dados.inserir')).toEqual([]);
  });

  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [1999, '19.99'],
    [999_999_999_999, '9999999999.99'],
  ])('converte %i centavos em "%s" e de volta, sem perder centavo', async (centavos, decimal) => {
    const { criar, produtoNovo, precos } = await montar();
    const variacao = {
      marca: 'X',
      tamanhoEmbalagem: 'Y',
      faixasPreco: [{ quantidadeMinima: 1, precoUnitario: centavos }],
    };

    const resposta = await criar(produtoNovo({ variacoes: [variacao] }));

    expect(precos('faixa_preco')[0]).toMatchObject({ preco_unitario: decimal });
    expect(resposta.body.variacoes[0].faixasPreco[0].precoUnitario).toBe(centavos);
  });

  it('aceita campos opcionais ausentes ou em branco e grava nulo', async () => {
    const { criar, produtoNovo, banco } = await montar();

    const resposta = await criar(
      produtoNovo({ ncm: undefined, ean: '  ', categoria: '', variacoes: [] }),
    );

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({ ncm: null, ean: null, categoria: null, variacoes: [] });
    expect(banco.linhas('produto')[0]).toMatchObject({ ncm: null, ean: null, categoria: null });
  });

  it('o operador cadastra produto e variações sem preços', async () => {
    const { criar, produtoNovo, operador, banco } = await montar();
    const variacoes = [{ marca: 'Chamex', tamanhoEmbalagem: '500 folhas', quantidadeEstoque: 0 }];

    const resposta = await criar(produtoNovo({ variacoes }), operador.autorizacao);

    expect(resposta.status).toBe(201);
    expect(resposta.body.variacoes[0]).toMatchObject({ faixasPreco: [], fardos: [] });
    expect(banco.linhas('variacao_produto')).toHaveLength(1);
  });

  it.each([
    ['faixas de preço', { faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 100 }] }],
    ['fardos', { fardos: [{ quantidadeUnidades: 6, precoFixo: 500 }] }],
    ['uma lista de faixas vazia', { faixasPreco: [] }],
  ])('responde 403 quando o operador envia %s, e não grava nada', async (_caso, precosEnviados) => {
    const { criar, produtoNovo, operador, banco } = await montar();
    const variacoes = [{ marca: 'Chamex', tamanhoEmbalagem: '500 folhas', ...precosEnviados }];

    const resposta = await criar(produtoNovo({ variacoes }), operador.autorizacao);

    expect(resposta.status).toBe(403);
    expect(resposta.body).toEqual({
      codigo: 'ACESSO_NEGADO',
      mensagem: 'Somente o operador chefe altera faixas de preço e fardos.',
    });
    expect(banco.linhas('produto')).toEqual([]);
  });

  it.each([
    ['o código interno', { ean: '7890000000001' }, ['codigoInterno']],
    ['o EAN', { codigoInterno: 'PAP-002' }, ['ean']],
    ['os dois', {}, ['codigoInterno', 'ean']],
  ])(
    'responde 409 PRODUTO_JA_CADASTRADO quando %s já existe',
    async (_caso, alteracoes, campos) => {
      const { criar, produtoNovo, banco } = await montar();
      await criar(produtoNovo());

      const resposta = await criar(produtoNovo(alteracoes));

      expect(resposta.status).toBe(409);
      expect(resposta.body).toEqual({
        codigo: 'PRODUTO_JA_CADASTRADO',
        mensagem: 'Já existe um produto com este código interno ou EAN.',
        detalhes: { campos },
      });
      expect(banco.linhas('produto')).toHaveLength(1);
    },
  );

  it('aceita dois produtos sem EAN', async () => {
    const { criar, produtoNovo } = await montar();
    await criar(produtoNovo({ ean: undefined }));

    const resposta = await criar(produtoNovo({ codigoInterno: 'PAP-002', ean: undefined }));

    expect(resposta.status).toBe(201);
  });

  it('responde 409 quando outro cadastro com o mesmo código chega durante a gravação', async () => {
    const { criar, produtoNovo, proxy, banco } = await montar();
    proxy.responderUmaVez('dados.lote', () => {
      banco.semear('produto', { codigo_interno: 'PAP-001', descricao: 'Chegou antes' });
      throw new ErroInterno(new Error('unique violation'));
    });

    const resposta = await criar(produtoNovo());

    expect(resposta.status).toBe(409);
    expect(resposta.body.detalhes).toEqual({ campos: ['codigoInterno'] });
  });

  it('não grava nada quando a transação falha', async () => {
    const { criar, produtoNovo, banco } = await montar();
    // A segunda variação aponta para um produto inexistente: o banco recusa e desfaz o lote.
    const original = banco.executar.bind(banco);
    jest.spyOn(banco, 'executar').mockImplementation((operacao, payload) => {
      const valores = payload.valores as Linha | undefined;
      const ehSegundaVariacao =
        payload.tabela === 'variacao_produto' && valores?.marca === 'Report';
      return original(
        operacao,
        ehSegundaVariacao ? { ...payload, valores: { ...valores, id_produto: 999 } } : payload,
      );
    });

    const resposta = await criar(produtoNovo());

    expect(resposta.status).toBe(500);
    expect(banco.linhas('produto')).toEqual([]);
    expect(banco.linhas('variacao_produto')).toEqual([]);
    expect(banco.linhas('faixa_preco')).toEqual([]);
  });

  const variacao = (alteracoes: Record<string, unknown>) => [
    { marca: 'Chamex', tamanhoEmbalagem: '500 folhas', ...alteracoes },
  ];
  it.each([
    ['código interno em branco', { codigoInterno: ' ' }, ['codigoInterno']],
    ['código interno acima de 30 caracteres', { codigoInterno: 'c'.repeat(31) }, ['codigoInterno']],
    ['descrição acima de 200 caracteres', { descricao: 'd'.repeat(201) }, ['descricao']],
    ['NCM com 7 dígitos', { ncm: '4802561' }, ['ncm']],
    ['EAN com letras', { ean: '78912345ABCDE' }, ['ean']],
    ['EAN com 15 dígitos', { ean: '789123456789512' }, ['ean']],
    ['ativo ausente', { ativo: undefined }, ['ativo']],
    ['variações ausentes', { variacoes: undefined }, ['variacoes']],
    ['marca em branco', { variacoes: variacao({ marca: '' }) }, ['variacoes.0.marca']],
    [
      'tamanho acima de 40 caracteres',
      { variacoes: variacao({ tamanhoEmbalagem: 't'.repeat(41) }) },
      ['variacoes.0.tamanhoEmbalagem'],
    ],
    [
      'estoque negativo',
      { variacoes: variacao({ quantidadeEstoque: -1 }) },
      ['variacoes.0.quantidadeEstoque'],
    ],
    [
      'quantidade mínima zero',
      { variacoes: variacao({ faixasPreco: [{ quantidadeMinima: 0, precoUnitario: 100 }] }) },
      ['variacoes.0.faixasPreco.0.quantidadeMinima'],
    ],
    [
      'preço negativo',
      { variacoes: variacao({ faixasPreco: [{ quantidadeMinima: 1, precoUnitario: -1 }] }) },
      ['variacoes.0.faixasPreco.0.precoUnitario'],
    ],
    [
      'preço com fração de centavo',
      { variacoes: variacao({ faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 25.5 }] }) },
      ['variacoes.0.faixasPreco.0.precoUnitario'],
    ],
    [
      'preço em texto',
      { variacoes: variacao({ fardos: [{ quantidadeUnidades: 6, precoFixo: '110,00' }] }) },
      ['variacoes.0.fardos.0.precoFixo'],
    ],
    [
      'preço acima do DECIMAL(12,2)',
      {
        variacoes: variacao({ fardos: [{ quantidadeUnidades: 6, precoFixo: 1_000_000_000_000 }] }),
      },
      ['variacoes.0.fardos.0.precoFixo'],
    ],
    [
      'duas faixas com a mesma quantidade mínima',
      {
        variacoes: variacao({
          faixasPreco: [
            { quantidadeMinima: 4, precoUnitario: 100 },
            { quantidadeMinima: 4, precoUnitario: 90 },
          ],
        }),
      },
      ['variacoes.0.faixasPreco.1.quantidadeMinima'],
    ],
    [
      'dois fardos com a mesma quantidade de unidades',
      {
        variacoes: variacao({
          fardos: [
            { quantidadeUnidades: 6, precoFixo: 100 },
            { quantidadeUnidades: 6, precoFixo: 90 },
          ],
        }),
      },
      ['variacoes.0.fardos.1.quantidadeUnidades'],
    ],
    [
      'mais de 10 faixas na variação',
      {
        variacoes: variacao({
          faixasPreco: Array.from({ length: 11 }, (_, i) => ({
            quantidadeMinima: i + 1,
            precoUnitario: 100,
          })),
        }),
      },
      ['variacoes.0.faixasPreco'],
    ],
    [
      'duas variações com a mesma marca e o mesmo tamanho',
      { variacoes: [...variacao({}), ...variacao({ marca: 'CHAMEX' })] },
      ['variacoes.1.tamanhoEmbalagem'],
    ],
    [
      'mais de 12 variações novas',
      {
        variacoes: Array.from({ length: 13 }, (_, i) => ({
          marca: `Marca ${i}`,
          tamanhoEmbalagem: '1 un',
        })),
      },
      ['variacoes'],
    ],
  ])('responde 400 com o campo recusado: %s', async (_caso, alteracoes, campos) => {
    const { criar, produtoNovo, banco } = await montar();

    const resposta = await criar(produtoNovo(alteracoes));

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos });
    expect(banco.linhas('produto')).toEqual([]);
  });

  it('responde 400 quando um produto novo traz uma variação com identificador', async () => {
    const { criar, produtoNovo } = await montar();

    const resposta = await criar(
      produtoNovo({
        variacoes: [{ idVariacao: 5, marca: 'Chamex', tamanhoEmbalagem: '500 folhas' }],
      }),
    );

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({
      codigo: 'VALIDATION_ERROR',
      mensagem: 'Um produto novo não pode receber variações já cadastradas.',
      detalhes: { campos: ['variacoes.0.idVariacao'] },
    });
  });

  it('cadastra 12 variações novas com 10 faixas e 10 fardos cada, dentro do limite de passos do proxy', async () => {
    const { criar, produtoNovo, banco, proxy } = await montar();
    const variacoes = Array.from({ length: 12 }, (_, v) => ({
      marca: `Marca ${v}`,
      tamanhoEmbalagem: '1 un',
      faixasPreco: Array.from({ length: 10 }, (_, f) => ({
        quantidadeMinima: f + 1,
        precoUnitario: 1000 - f,
      })),
      fardos: Array.from({ length: 10 }, (_, f) => ({
        quantidadeUnidades: (f + 1) * 6,
        precoFixo: 5000 + v,
      })),
    }));

    const resposta = await criar(produtoNovo({ variacoes }));

    expect(resposta.status).toBe(201);
    expect(banco.linhas('faixa_preco')).toHaveLength(120);
    expect(banco.linhas('fardo')).toHaveLength(120);
    const passos = proxy.chamadasDe('dados.lote')[0]?.payload.passos as unknown[];
    expect(passos.length).toBeLessThanOrEqual(20);
    // Cada fardo ficou na variação certa: o preço carrega o número da variação.
    for (const produtoVariacao of resposta.body.variacoes as ProdutoDaResposta['variacoes']) {
      const numero = Number(produtoVariacao.marca.replace('Marca ', ''));
      expect(produtoVariacao.fardos.every((fardo) => fardo.precoFixo === 5000 + numero)).toBe(true);
      expect(produtoVariacao.fardos).toHaveLength(10);
    }
  });
});

describe('GET /produtos e GET /produtos/:id (UC04)', () => {
  async function montarCatalogo() {
    const cenario = await montar();
    await cenario.criar(cenario.produtoNovo());
    await cenario.criar(
      cenario.produtoNovo({
        codigoInterno: 'CAN-010',
        descricao: 'Caneta esferográfica azul',
        ean: '7890000000017',
        variacoes: [],
      }),
    );
    await cenario.criar(
      cenario.produtoNovo({
        codigoInterno: 'ENV-003',
        descricao: 'Envelope pardo',
        ean: undefined,
        variacoes: [],
      }),
    );
    return cenario;
  }

  it('lista todos os produtos em ordem alfabética da descrição, com variações e preços', async () => {
    const { listar } = await montarCatalogo();

    const resposta = await listar();

    expect(resposta.status).toBe(200);
    const produtos = resposta.body as ProdutoDaResposta[];
    expect(produtos.map((produto) => produto.descricao)).toEqual([
      'Caneta esferográfica azul',
      'Envelope pardo',
      'Papel sulfite A4',
    ]);
    expect(produtos[2]?.variacoes.map((v) => v.faixasPreco.length)).toEqual([2, 1]);
  });

  it.each([
    ['trecho da descrição, sem diferenciar maiúsculas', 'ESFERO', ['CAN-010']],
    ['trecho do código interno', 'env-', ['ENV-003']],
    ['trecho do EAN', '0000001', ['CAN-010']],
    ['termo presente em mais de um produto', 'pa', ['ENV-003', 'PAP-001']],
    ['termo sem resultado', 'grampeador', []],
    ['termo em branco: traz todos', '   ', ['CAN-010', 'ENV-003', 'PAP-001']],
  ])('busca por %s', async (_caso, termo, codigos) => {
    const { listar } = await montarCatalogo();

    const resposta = await listar(termo);

    expect(resposta.status).toBe(200);
    expect((resposta.body as { codigoInterno: string }[]).map((p) => p.codigoInterno)).toEqual(
      codigos,
    );
  });

  it('trata % e _ do termo de busca como texto comum', async () => {
    const { listar } = await montarCatalogo();

    expect((await listar('%')).body).toEqual([]);
  });

  it('responde 400 quando o termo passa de 100 caracteres', async () => {
    const { listar } = await montarCatalogo();

    const resposta = await listar('a'.repeat(101));

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos: ['q'] });
  });

  it('obtém um produto pelo identificador', async () => {
    const { obter } = await montarCatalogo();

    const resposta = await obter(1);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ idProduto: 1, codigoInterno: 'PAP-001' });
    expect(resposta.body.variacoes).toHaveLength(2);
  });

  it('responde 404 PRODUTO_NAO_ENCONTRADO para um identificador sem produto', async () => {
    const { obter } = await montarCatalogo();

    const resposta = await obter(99);

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({
      codigo: 'PRODUTO_NAO_ENCONTRADO',
      mensagem: 'Produto não encontrado.',
    });
  });

  it('responde 400 para um identificador não numérico', async () => {
    const { obter } = await montarCatalogo();

    expect((await obter('abc')).status).toBe(400);
  });

  it('busca os preços de mais de 100 variações em blocos', async () => {
    const { listar, banco, proxy } = await montarCatalogo();
    for (let i = 0; i < 150; i += 1) {
      const [variacao] = banco.semear('variacao_produto', {
        id_produto: 2,
        marca: `Marca ${i}`,
        tamanho_embalagem: '1 un',
      });
      banco.semear('faixa_preco', {
        id_variacao: variacao?.id_variacao,
        quantidade_minima: 1,
        preco_unitario: '1.50',
      });
    }
    const antes = proxy.chamadas.length;

    const resposta = await listar();

    const caneta = (resposta.body as ProdutoDaResposta[])[0];
    expect(caneta?.variacoes).toHaveLength(150);
    expect(caneta?.variacoes.every((v) => v.faixasPreco[0]?.precoUnitario === 150)).toBe(true);
    const consultasDeFaixa = proxy.chamadas
      .slice(antes)
      .filter((c) => c.payload.tabela === 'faixa_preco');
    expect(consultasDeFaixa).toHaveLength(2);
  });
});

describe('PUT /produtos/:id (UC04)', () => {
  it('o operador altera dados do produto e da variação, sem tocar nos preços', async () => {
    const { criarPadrao, alterar, operador, precos, banco } = await montar();
    const { semPrecos } = await criarPadrao();
    const precosAntes = precos('faixa_preco');
    const [chamex, report] = semPrecos.variacoes as Linha[];

    const resposta = await alterar(
      1,
      {
        ...semPrecos,
        descricao: 'Papel sulfite A4 75g',
        ativo: false,
        variacoes: [{ ...chamex, tamanhoEmbalagem: 'Resma 500 fls' }, report],
      },
      operador.autorizacao,
    );

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ descricao: 'Papel sulfite A4 75g', ativo: false });
    expect(banco.linhas('variacao_produto')[0]).toMatchObject({
      tamanho_embalagem: 'Resma 500 fls',
      quantidade_estoque: 40,
    });
    expect(precos('faixa_preco')).toEqual(precosAntes);
  });

  it('responde 403 quando o operador envia preços em uma alteração', async () => {
    const { criarPadrao, alterar, operador, precos } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex, report] = semPrecos.variacoes as Linha[];

    const resposta = await alterar(
      1,
      {
        ...semPrecos,
        variacoes: [
          { ...chamex, faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 1 }] },
          report,
        ],
      },
      operador.autorizacao,
    );

    expect(resposta.status).toBe(403);
    expect(precos('faixa_preco')[0]).toMatchObject({ preco_unitario: '25.00' });
  });

  it('o operador chefe altera, inclui e remove faixas e fardos, preservando o identificador do que só mudou de preço', async () => {
    const { criarPadrao, alterar, precos } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex, report] = semPrecos.variacoes as Linha[];

    const resposta = await alterar(1, {
      ...semPrecos,
      variacoes: [
        {
          ...chamex,
          faixasPreco: [
            { quantidadeMinima: 1, precoUnitario: 2650 },
            { quantidadeMinima: 12, precoUnitario: 1750 },
          ],
          fardos: [
            { quantidadeUnidades: 10, precoFixo: 16500 },
            { quantidadeUnidades: 20, precoFixo: 31000 },
          ],
        },
        report,
      ],
    });

    expect(resposta.status).toBe(200);
    expect(precos('faixa_preco')).toEqual([
      { id_faixa_preco: 1, idVariacao: 1, quantidade_minima: 1, preco_unitario: '26.50' },
      { id_faixa_preco: 3, idVariacao: 2, quantidade_minima: 1, preco_unitario: '23.99' },
      { id_faixa_preco: 4, idVariacao: 1, quantidade_minima: 12, preco_unitario: '17.50' },
    ]);
    expect(precos('fardo')).toEqual([
      { id_fardo: 1, idVariacao: 1, quantidade_unidades: 10, preco_fixo: '165.00' },
      { id_fardo: 2, idVariacao: 1, quantidade_unidades: 20, preco_fixo: '310.00' },
    ]);
    expect((resposta.body as ProdutoDaResposta).variacoes[0]?.faixasPreco).toEqual([
      { idFaixaPreco: 1, quantidadeMinima: 1, precoUnitario: 2650 },
      { idFaixaPreco: 4, quantidadeMinima: 12, precoUnitario: 1750 },
    ]);
  });

  it('inclui uma variação nova com seus preços', async () => {
    const { criarPadrao, alterar, precos } = await montar();
    const { semPrecos } = await criarPadrao();
    const nova = {
      marca: 'Chamex',
      tamanhoEmbalagem: '100 folhas',
      quantidadeEstoque: 5,
      faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 700 }],
    };

    const resposta = await alterar(1, {
      ...semPrecos,
      variacoes: [...(semPrecos.variacoes as Linha[]), nova],
    });

    expect(resposta.status).toBe(200);
    expect((resposta.body as ProdutoDaResposta).variacoes[2]).toMatchObject({
      idVariacao: 3,
      tamanhoEmbalagem: '100 folhas',
      quantidadeEstoque: 5,
      faixasPreco: [{ idFaixaPreco: 4, quantidadeMinima: 1, precoUnitario: 700 }],
    });
    expect(precos('faixa_preco')[3]).toMatchObject({ idVariacao: 3, preco_unitario: '7.00' });
  });

  it('remove a variação que não veio no corpo, com os preços dela', async () => {
    const { criarPadrao, alterar, banco, precos } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex] = semPrecos.variacoes as Linha[];

    const resposta = await alterar(1, { ...semPrecos, variacoes: [chamex] });

    expect(resposta.status).toBe(200);
    expect(banco.linhas('variacao_produto').map((linha) => linha.id_variacao)).toEqual([1]);
    expect(precos('faixa_preco').map((faixa) => faixa.idVariacao)).toEqual([1, 1]);
  });

  it('responde 403 quando o operador remove uma variação que tem preços', async () => {
    const { criarPadrao, alterar, operador, banco } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex] = semPrecos.variacoes as Linha[];

    const resposta = await alterar(1, { ...semPrecos, variacoes: [chamex] }, operador.autorizacao);

    expect(resposta.status).toBe(403);
    expect(resposta.body.mensagem).toBe(
      'Somente o operador chefe remove uma variação que tem faixas de preço ou fardos.',
    );
    expect(banco.linhas('variacao_produto')).toHaveLength(2);
  });

  it('o operador remove uma variação sem preços e sem estoque', async () => {
    const { criar, alterar, produtoNovo, operador, banco } = await montar();
    const variacoes = [
      { marca: 'Chamex', tamanhoEmbalagem: '500 folhas' },
      { marca: 'Report', tamanhoEmbalagem: '500 folhas' },
    ];
    await criar(produtoNovo({ variacoes }), operador.autorizacao);

    const resposta = await alterar(
      1,
      produtoNovo({ variacoes: [{ idVariacao: 1, ...variacoes[0] }] }),
      operador.autorizacao,
    );

    expect(resposta.status).toBe(200);
    expect(banco.linhas('variacao_produto')).toHaveLength(1);
  });

  it('responde 409 REGISTRO_EM_USO ao remover uma variação com estoque', async () => {
    const { criarPadrao, alterar, banco } = await montar();
    const { semPrecos } = await criarPadrao();
    const [, report] = semPrecos.variacoes as Linha[];

    const resposta = await alterar(1, { ...semPrecos, variacoes: [report] });

    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({
      codigo: 'REGISTRO_EM_USO',
      mensagem: 'A variação Chamex · 500 folhas ainda tem estoque e não pode ser removida.',
    });
    expect(banco.linhas('variacao_produto')).toHaveLength(2);
  });

  it('responde 409 REGISTRO_EM_USO ao remover uma variação já movimentada', async () => {
    const { criarPadrao, alterar, banco } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex] = semPrecos.variacoes as Linha[];
    banco.semear('movimentacao_estoque', {
      id_variacao: 2,
      tipo: 'AJUSTE',
      quantidade: 1,
      motivo: 'Teste',
      data_movimentacao: '2026-11-01T10:00:00.000Z',
    });

    const resposta = await alterar(1, { ...semPrecos, variacoes: [chamex] });

    expect(resposta.status).toBe(409);
    expect(resposta.body.mensagem).toBe(
      'A variação Report · 500 folhas já foi usada em pedido, orçamento ou movimentação de estoque e não pode ser removida.',
    );
    expect(banco.linhas('variacao_produto')).toHaveLength(2);
  });

  it.each([
    [
      'faixa de preço',
      'item_orcamento',
      { faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 2500 }] },
      'Uma faixa de preço já usada em orçamento não pode ser removida. Mantenha a faixa e altere só o preço.',
    ],
    [
      'fardo',
      'item_pedido',
      { fardos: [] },
      'Um fardo já usado em pedido ou orçamento não pode ser removido. Mantenha o fardo e altere só o preço.',
    ],
  ])(
    'responde 409 REGISTRO_EM_USO ao remover %s já usada',
    async (_caso, tabela, precosEnviados, mensagem) => {
      const { criarPadrao, alterar, proxy, banco, precos } = await montar();
      const { semPrecos } = await criarPadrao();
      const [chamex, report] = semPrecos.variacoes as Linha[];
      const precosAntes = [precos('faixa_preco'), precos('fardo')];
      proxy.responder('dados.consultar', (chamada: ChamadaAoProxy) =>
        chamada.payload.tabela === tabela
          ? { ok: true, dados: [{ referencia: 1 }], proximoCursor: null }
          : chamada.payload.tabela === 'item_orcamento' ||
              chamada.payload.tabela === 'item_resposta_orcamento'
            ? { ok: true, dados: [], proximoCursor: null }
            : banco.atender(chamada),
      );

      const resposta = await alterar(1, {
        ...semPrecos,
        variacoes: [{ ...chamex, ...precosEnviados }, report],
      });

      expect(resposta.status).toBe(409);
      expect(resposta.body).toEqual({ codigo: 'REGISTRO_EM_USO', mensagem });
      expect([precos('faixa_preco'), precos('fardo')]).toEqual(precosAntes);
    },
  );

  it('altera só o preço de uma faixa já usada em orçamento, sem conferir referências', async () => {
    const { criarPadrao, alterar, proxy, precos } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex, report] = semPrecos.variacoes as Linha[];
    const antes = proxy.chamadas.length;

    const resposta = await alterar(1, {
      ...semPrecos,
      variacoes: [
        {
          ...chamex,
          faixasPreco: [
            { quantidadeMinima: 1, precoUnitario: 2700 },
            { quantidadeMinima: 4, precoUnitario: 1900 },
          ],
        },
        report,
      ],
    });

    expect(resposta.status).toBe(200);
    expect(precos('faixa_preco')[0]).toMatchObject({ id_faixa_preco: 1, preco_unitario: '27.00' });
    expect(proxy.chamadas.slice(antes).map((c) => c.payload.tabela)).not.toContain(
      'item_orcamento',
    );
  });

  it('responde 400 quando uma variação do corpo pertence a outro produto', async () => {
    const { criarPadrao, criar, alterar, produtoNovo } = await montar();
    const { semPrecos } = await criarPadrao();
    await criar(
      produtoNovo({
        codigoInterno: 'PAP-002',
        ean: undefined,
        variacoes: [{ marca: 'Outra', tamanhoEmbalagem: '1 un' }],
      }),
    );

    const resposta = await alterar(1, {
      ...semPrecos,
      variacoes: [
        ...(semPrecos.variacoes as Linha[]),
        { idVariacao: 3, marca: 'Outra', tamanhoEmbalagem: '1 un' },
      ],
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({
      codigo: 'VALIDATION_ERROR',
      mensagem: 'A variação informada não pertence a este produto.',
      detalhes: { campos: ['variacoes.2.idVariacao'] },
    });
  });

  it.each([
    [
      'estoque informado para variação existente',
      (v: Linha[]) => [{ ...v[0], quantidadeEstoque: 500 }, v[1]],
      ['variacoes.0.quantidadeEstoque'],
    ],
    [
      'a mesma variação duas vezes',
      (v: Linha[]) => [v[0], { ...v[0], marca: 'Outra' }],
      ['variacoes.1.idVariacao'],
    ],
  ])('responde 400: %s', async (_caso, variacoesDe, campos) => {
    const { criarPadrao, alterar, banco } = await montar();
    const { semPrecos } = await criarPadrao();

    const resposta = await alterar(1, {
      ...semPrecos,
      variacoes: variacoesDe(semPrecos.variacoes as Linha[]),
    });

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos });
    expect(banco.linhas('variacao_produto')[0]).toMatchObject({ quantidade_estoque: 40 });
  });

  it('não grava nada quando o corpo repete o que está gravado', async () => {
    const { criarPadrao, alterar, proxy } = await montar();
    const { produto, semPrecos } = await criarPadrao();
    const lotesAntes = proxy.chamadasDe('dados.lote').length;

    const resposta = await alterar(1, semPrecos);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual(produto);
    expect(proxy.chamadasDe('dados.lote')).toHaveLength(lotesAntes);
  });

  it('responde 409 quando o código interno passa a ser o de outro produto, e aceita manter o próprio', async () => {
    const { criarPadrao, criar, alterar, produtoNovo } = await montar();
    const { semPrecos } = await criarPadrao();
    await criar(produtoNovo({ codigoInterno: 'PAP-002', ean: undefined, variacoes: [] }));

    const conflito = await alterar(1, { ...semPrecos, codigoInterno: 'PAP-002' });
    const proprio = await alterar(1, { ...semPrecos, descricao: 'Papel A4' });

    expect(conflito.status).toBe(409);
    expect(conflito.body.detalhes).toEqual({ campos: ['codigoInterno'] });
    expect(proprio.status).toBe(200);
  });

  it('responde 404 PRODUTO_NAO_ENCONTRADO', async () => {
    const { alterar, produtoNovo } = await montar();

    const resposta = await alterar(99, produtoNovo({ variacoes: [] }));

    expect(resposta.status).toBe(404);
    expect(resposta.body.codigo).toBe('PRODUTO_NAO_ENCONTRADO');
  });

  it('desfaz a alteração inteira quando a transação falha', async () => {
    const { criarPadrao, alterar, banco, precos } = await montar();
    const { semPrecos } = await criarPadrao();
    const [chamex, report] = semPrecos.variacoes as Linha[];
    const original = banco.executar.bind(banco);
    jest.spyOn(banco, 'executar').mockImplementation((operacao, payload) => {
      if (operacao === 'dados.atualizar' && payload.tabela === 'fardo') {
        throw new ErroInterno(new Error('falha no meio do lote'));
      }
      return original(operacao, payload);
    });

    const resposta = await alterar(1, {
      ...semPrecos,
      descricao: 'Mudou',
      variacoes: [
        {
          ...chamex,
          faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 9999 }],
          fardos: [{ quantidadeUnidades: 10, precoFixo: 1 }],
        },
        report,
      ],
    });

    expect(resposta.status).toBe(500);
    expect(banco.linhas('produto')[0]).toMatchObject({ descricao: 'Papel sulfite A4' });
    expect(precos('faixa_preco').map((f) => f.preco_unitario)).toEqual(['25.00', '19.00', '23.99']);
  });

  it('divide em mais de uma transação a alteração que passa de 20 passos', async () => {
    const { criar, alterar, produtoNovo, proxy, precos } = await montar();
    const faixas = (preco: number) =>
      Array.from({ length: 10 }, (_, f) => ({ quantidadeMinima: f + 1, precoUnitario: preco }));
    const variacoes = ['A', 'B', 'C'].map((marca) => ({
      marca,
      tamanhoEmbalagem: '1 un',
      faixasPreco: faixas(1000),
    }));
    await criar(produtoNovo({ variacoes }));
    const lotesAntes = proxy.chamadasDe('dados.lote').length;

    const resposta = await alterar(
      1,
      produtoNovo({
        variacoes: variacoes.map((v, i) => ({
          idVariacao: i + 1,
          marca: v.marca,
          tamanhoEmbalagem: v.tamanhoEmbalagem,
          faixasPreco: faixas(900),
        })),
      }),
    );

    expect(resposta.status).toBe(200);
    expect(precos('faixa_preco').every((faixa) => faixa.preco_unitario === '9.00')).toBe(true);
    const lotes = proxy.chamadasDe('dados.lote').slice(lotesAntes);
    expect(lotes.map((lote) => (lote.payload.passos as unknown[]).length)).toEqual([20, 10]);
  });
});

describe('autorização das rotas de produtos', () => {
  const ROTAS = [
    ['get', '/produtos'],
    ['get', '/produtos/1'],
    ['post', '/produtos'],
    ['put', '/produtos/1'],
  ] as const;

  it.each(ROTAS)('%s %s responde 401 sem sessão', async (metodo, rota) => {
    const { app } = await montar();

    expect((await request(app)[metodo](rota)).status).toBe(401);
  });

  it.each(ROTAS)('%s %s responde 403 para o perfil FINANCEIRO', async (metodo, rota) => {
    const { app, entrarComo } = await montar();
    const financeiro = await entrarComo('FINANCEIRO');

    const resposta = await request(app)[metodo](rota).set('Authorization', financeiro.autorizacao);

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('ACESSO_NEGADO');
  });
});
