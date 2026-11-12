import request from 'supertest';
import { ErroInterno } from '../../erros';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';

const CNPJ = '44555666000199';

async function montar() {
  const cenario = montarCenarioDeCadastros();
  const chefe = await cenario.entrarComo('OPERADOR_CHEFE');
  const fornecedorNovo = (alteracoes: Record<string, unknown> = {}) => ({
    cnpj: CNPJ,
    razaoSocial: 'Distribuidora Papel Bom',
    nomeContato: 'Rui Lima',
    telefoneContato: '(62) 3555-2000',
    emailContato: 'vendas@papelbom.com.br',
    ...alteracoes,
  });
  const cadastrar = (corpo: unknown, autorizacao = chefe.autorizacao) =>
    request(cenario.app)
      .post('/fornecedores')
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const listar = (autorizacao = chefe.autorizacao) =>
    request(cenario.app).get('/fornecedores').set('Authorization', autorizacao);
  return { ...cenario, chefe, fornecedorNovo, cadastrar, listar };
}

describe('POST /fornecedores (UC22)', () => {
  it('responde 201 com o fornecedor criado', async () => {
    const { cadastrar, fornecedorNovo, banco, linhas, chefe } = await montar();

    const resposta = await cadastrar(fornecedorNovo({ cnpj: '44.555.666/0001-99' }));

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({ idFornecedor: 1, ...fornecedorNovo() });
    expect(banco.linhas('fornecedor')).toEqual([
      expect.objectContaining({
        id_fornecedor: 1,
        cnpj: CNPJ,
        razao_social: 'Distribuidora Papel Bom',
      }),
    ]);
    expect(linhas.find((linha) => linha.evento === 'fornecedor_cadastrado')).toMatchObject({
      idFornecedor: 1,
      idAutor: chefe.idOperador,
    });
  });

  it.each([
    ['ausentes', {}],
    ['nulos', { nomeContato: null, telefoneContato: null, emailContato: null }],
    ['em branco', { nomeContato: '  ', telefoneContato: '', emailContato: '' }],
  ])('grava nulo nos dados de contato %s', async (_caso, contato) => {
    const { cadastrar, banco } = await montar();

    const resposta = await cadastrar({
      cnpj: CNPJ,
      razaoSocial: 'Distribuidora Papel Bom',
      ...contato,
    });

    expect(resposta.status).toBe(201);
    expect(resposta.body).toMatchObject({
      nomeContato: null,
      telefoneContato: null,
      emailContato: null,
    });
    expect(banco.linhas('fornecedor')[0]).toMatchObject({
      nome_contato: null,
      telefone_contato: null,
      email_contato: null,
    });
  });

  it('responde 200 com o cadastro existente, sem alterá-lo, quando o CNPJ já está cadastrado', async () => {
    const { cadastrar, fornecedorNovo, banco, linhas } = await montar();
    await cadastrar(fornecedorNovo());

    const resposta = await cadastrar(
      fornecedorNovo({ razaoSocial: 'Outro nome', nomeContato: 'Outra pessoa' }),
    );

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual({ idFornecedor: 1, ...fornecedorNovo() });
    expect(banco.linhas('fornecedor')).toHaveLength(1);
    expect(linhas.filter((linha) => linha.evento === 'fornecedor_cadastrado')).toHaveLength(1);
  });

  it('responde 200 com o cadastro que chegou primeiro quando dois cadastros do mesmo CNPJ concorrem', async () => {
    const { cadastrar, fornecedorNovo, proxy, banco } = await montar();
    proxy.responderUmaVez('dados.inserir', () => {
      banco.semear('fornecedor', { cnpj: CNPJ, razao_social: 'Chegou antes' });
      throw new ErroInterno(new Error('unique violation'));
    });

    const resposta = await cadastrar(fornecedorNovo());

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({ idFornecedor: 1, razaoSocial: 'Chegou antes' });
  });

  it('responde 500 quando a gravação falha e o CNPJ continua sem cadastro', async () => {
    const { cadastrar, fornecedorNovo, proxy } = await montar();
    proxy.responderUmaVez('dados.inserir', new ErroInterno(new Error('banco fora do ar')));

    const resposta = await cadastrar(fornecedorNovo());

    expect(resposta.status).toBe(500);
    expect(resposta.body.codigo).toBe('INTERNAL_ERROR');
  });

  it.each([
    ['CNPJ ausente', { cnpj: undefined }, ['cnpj']],
    ['CNPJ com 15 dígitos', { cnpj: '445556660001999' }, ['cnpj']],
    ['razão social em branco', { razaoSocial: ' ' }, ['razaoSocial']],
    ['contato acima de 100 caracteres', { nomeContato: 'a'.repeat(101) }, ['nomeContato']],
    ['telefone acima de 20 caracteres', { telefoneContato: '1'.repeat(21) }, ['telefoneContato']],
    ['e-mail malformado', { emailContato: 'vendas' }, ['emailContato']],
  ])('responde 400 com o campo recusado: %s', async (_caso, alteracoes, campos) => {
    const { cadastrar, fornecedorNovo, banco } = await montar();

    const resposta = await cadastrar(fornecedorNovo(alteracoes));

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos });
    expect(banco.linhas('fornecedor')).toEqual([]);
  });

  it('responde 403 para o operador, que só consulta fornecedores', async () => {
    const { cadastrar, fornecedorNovo, entrarComo, banco } = await montar();
    const operador = await entrarComo('OPERADOR');

    const resposta = await cadastrar(fornecedorNovo(), operador.autorizacao);

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('ACESSO_NEGADO');
    expect(banco.linhas('fornecedor')).toEqual([]);
  });

  it('responde 401 sem sessão', async () => {
    const { app, fornecedorNovo } = await montar();

    expect((await request(app).post('/fornecedores').send(fornecedorNovo())).status).toBe(401);
  });
});

describe('GET /fornecedores (UC22)', () => {
  it('lista os fornecedores em ordem alfabética da razão social', async () => {
    const { cadastrar, fornecedorNovo, listar } = await montar();
    await cadastrar(fornecedorNovo());
    await cadastrar(fornecedorNovo({ cnpj: '11222333000181', razaoSocial: 'Atacado Central' }));

    const resposta = await listar();

    expect(resposta.status).toBe(200);
    expect(resposta.body.map((f: { razaoSocial: string }) => f.razaoSocial)).toEqual([
      'Atacado Central',
      'Distribuidora Papel Bom',
    ]);
    expect(resposta.body[0]).not.toHaveProperty('dataCadastro');
  });

  it('traz todos os fornecedores quando passam de uma página do proxy', async () => {
    const { listar, banco } = await montar();
    const total = 501;
    for (let lote = 0; lote < total; lote += 100) {
      banco.semear(
        'fornecedor',
        Array.from({ length: Math.min(100, total - lote) }, (_, i) => ({
          cnpj: String(10000000000000 + lote + i),
          razao_social: `Fornecedor ${String(lote + i).padStart(3, '0')}`,
        })),
      );
    }

    const resposta = await listar();

    expect(resposta.body).toHaveLength(total);
  });

  it('o operador consulta; os demais perfis, não', async () => {
    const { listar, entrarComo } = await montar();
    const operador = await entrarComo('OPERADOR');
    const financeiro = await entrarComo('FINANCEIRO');

    expect((await listar(operador.autorizacao)).status).toBe(200);
    expect((await listar(financeiro.autorizacao)).status).toBe(403);
    expect((await listar('')).status).toBe(401);
  });
});
