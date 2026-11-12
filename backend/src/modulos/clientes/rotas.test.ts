import request from 'supertest';
import { ErroInterno } from '../../erros';
import { montarCenarioDeCadastros } from '../../testing/cenarioDeCadastros';
import type { Linha } from '../../testing/bancoFalso';

const AGORA = new Date('2026-11-11T15:00:00Z');
const CNPJ = '11222333000181';
const CNPJ_COM_MASCARA = '11.222.333/0001-81';

const ENDERECO = {
  tipo: 'CADASTRAL',
  logradouro: 'Avenida Goiás',
  numero: '1200',
  complemento: 'Sala 4',
  bairro: 'Centro',
  cidade: 'Goiânia',
  uf: 'GO',
  cep: '74000000',
};

async function montar() {
  const cenario = montarCenarioDeCadastros({ agora: () => AGORA });
  const operador = await cenario.entrarComo('OPERADOR');
  const idVendedor = cenario.semearUsuario('VENDEDOR', 'vera');
  const clienteNovo = (alteracoes: Record<string, unknown> = {}) => ({
    cnpj: CNPJ,
    razaoSocial: 'Papelaria Alfa Ltda',
    nomeContato: 'Marina Souza',
    telefoneContato: '(62) 3222-1000',
    emailContato: 'compras@alfa.com.br',
    tipoUnidade: 'MATRIZ',
    idOperadorVendedor: idVendedor,
    enderecos: [ENDERECO],
    aceiteLgpd: true,
    ...alteracoes,
  });
  const cadastrar = (corpo: unknown, autorizacao = operador.autorizacao) =>
    request(cenario.app)
      .post('/clientes')
      .set('Authorization', autorizacao)
      .send(corpo as object);
  const buscar = (cnpj: string, autorizacao = operador.autorizacao) =>
    request(cenario.app).get('/clientes/busca').query({ cnpj }).set('Authorization', autorizacao);
  return { ...cenario, operador, idVendedor, clienteNovo, cadastrar, buscar };
}

describe('POST /clientes (UC02)', () => {
  it('responde 201 com a ficha e grava o cliente, os endereços e o aceite da LGPD', async () => {
    const { cadastrar, clienteNovo, banco, idVendedor } = await montar();
    const entrega = { ...ENDERECO, tipo: 'ENTREGA', numero: 'S/N', complemento: undefined };

    const resposta = await cadastrar(clienteNovo({ enderecos: [ENDERECO, entrega] }));

    expect(resposta.status).toBe(201);
    expect(resposta.body).toEqual({
      idCliente: 1,
      cnpj: CNPJ,
      razaoSocial: 'Papelaria Alfa Ltda',
      nomeContato: 'Marina Souza',
      telefoneContato: '(62) 3222-1000',
      emailContato: 'compras@alfa.com.br',
      tipoUnidade: 'MATRIZ',
      status: 'ATIVO',
      vendedorResponsavel: 'vera',
      enderecos: [
        { idEndereco: 1, ...ENDERECO },
        { idEndereco: 2, ...entrega, complemento: null },
      ],
      dividaEmAberto: 0,
    });
    expect(banco.linhas('cliente')).toEqual([
      expect.objectContaining({
        id_cliente: 1,
        cnpj: CNPJ,
        id_operador_vendedor: idVendedor,
        aceite_lgpd: true,
        data_aceite_lgpd: AGORA.toISOString(),
      }),
    ]);
    expect(banco.linhas('endereco_cliente').map((linha) => linha.id_cliente)).toEqual([1, 1]);
  });

  it('grava o cliente e os endereços em uma única transação', async () => {
    const { cadastrar, clienteNovo, proxy } = await montar();

    await cadastrar(clienteNovo());

    const [lote] = proxy.chamadasDe('dados.lote');
    expect(lote?.operationId).toBe('UC02-cadastrar-cliente');
    expect(proxy.chamadasDe('dados.inserir')).toEqual([]);
  });

  it('normaliza máscara, espaços, UF minúscula e campos opcionais em branco', async () => {
    const { cadastrar, clienteNovo, banco } = await montar();

    const resposta = await cadastrar(
      clienteNovo({
        cnpj: CNPJ_COM_MASCARA,
        razaoSocial: '  Papelaria Alfa Ltda  ',
        telefoneContato: '   ',
        emailContato: '',
        enderecos: [{ ...ENDERECO, uf: 'go', cep: '74000-000', complemento: '' }],
      }),
    );

    expect(resposta.status).toBe(201);
    expect(banco.linhas('cliente')[0]).toMatchObject({
      cnpj: CNPJ,
      razao_social: 'Papelaria Alfa Ltda',
      telefone_contato: null,
      email_contato: null,
    });
    expect(banco.linhas('endereco_cliente')[0]).toMatchObject({
      uf: 'GO',
      cep: '74000000',
      complemento: null,
    });
  });

  it.each([
    ['ausente', undefined],
    ['falso', false],
    ['texto', 'true'],
  ])(
    'bloqueia o cadastro sem o aceite da LGPD (%s) e não grava nada',
    async (_caso, aceiteLgpd) => {
      const { cadastrar, clienteNovo, banco } = await montar();

      const resposta = await cadastrar(clienteNovo({ aceiteLgpd }));

      expect(resposta.status).toBe(400);
      expect(resposta.body).toEqual({
        codigo: 'VALIDATION_ERROR',
        mensagem: 'Os dados enviados são inválidos.',
        detalhes: { campos: ['aceiteLgpd'] },
      });
      expect(banco.linhas('cliente')).toEqual([]);
    },
  );

  it.each([
    ['CNPJ com 13 dígitos', { cnpj: '1122233300018' }, ['cnpj']],
    ['CNPJ com letras', { cnpj: '11222333000I81' }, ['cnpj']],
    ['razão social em branco', { razaoSocial: '   ' }, ['razaoSocial']],
    ['razão social acima de 150 caracteres', { razaoSocial: 'a'.repeat(151) }, ['razaoSocial']],
    ['contato ausente', { nomeContato: undefined }, ['nomeContato']],
    ['e-mail malformado', { emailContato: 'compras@' }, ['emailContato']],
    ['tipo de unidade desconhecido', { tipoUnidade: 'SEDE' }, ['tipoUnidade']],
    ['vendedor não numérico', { idOperadorVendedor: '7' }, ['idOperadorVendedor']],
    ['nenhum endereço', { enderecos: [] }, ['enderecos']],
    [
      'tipo de endereço desconhecido',
      { enderecos: [{ ...ENDERECO, tipo: 'COBRANCA' }] },
      ['enderecos.0.tipo'],
    ],
    ['UF inexistente', { enderecos: [{ ...ENDERECO, uf: 'XX' }] }, ['enderecos.0.uf']],
    [
      'CEP com 7 dígitos',
      { enderecos: [ENDERECO, { ...ENDERECO, cep: '7400000' }] },
      ['enderecos.1.cep'],
    ],
    [
      'número acima de 10 caracteres',
      { enderecos: [{ ...ENDERECO, numero: '12345678901' }] },
      ['enderecos.0.numero'],
    ],
  ])('responde 400 com o campo recusado: %s', async (_caso, alteracoes, campos) => {
    const { cadastrar, clienteNovo, banco } = await montar();

    const resposta = await cadastrar(clienteNovo(alteracoes));

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos });
    expect(banco.linhas('cliente')).toEqual([]);
  });

  it.each([
    ['inexistente', () => 999],
    [
      'inativo',
      (c: Awaited<ReturnType<typeof montar>>) => c.semearUsuario('VENDEDOR', 'ivo', 'INATIVO'),
    ],
    ['com outro perfil', (c: Awaited<ReturnType<typeof montar>>) => c.operador.idOperador],
  ])('responde 400 quando o vendedor responsável é %s', async (_caso, idDe) => {
    const cenario = await montar();

    const resposta = await cenario.cadastrar(
      cenario.clienteNovo({ idOperadorVendedor: idDe(cenario) }),
    );

    expect(resposta.status).toBe(400);
    expect(resposta.body).toEqual({
      codigo: 'VALIDATION_ERROR',
      mensagem: 'O vendedor responsável deve ser um usuário ativo com perfil de vendedor.',
      detalhes: { campos: ['idOperadorVendedor'] },
    });
    expect(cenario.banco.linhas('cliente')).toEqual([]);
  });

  it('responde 409 CLIENTE_JA_CADASTRADO quando o CNPJ já existe, mesmo com máscara', async () => {
    const { cadastrar, clienteNovo, banco } = await montar();
    await cadastrar(clienteNovo());

    const resposta = await cadastrar(clienteNovo({ cnpj: CNPJ_COM_MASCARA, razaoSocial: 'Outra' }));

    expect(resposta.status).toBe(409);
    expect(resposta.body).toEqual({
      codigo: 'CLIENTE_JA_CADASTRADO',
      mensagem: 'Já existe um cliente cadastrado com este CNPJ.',
    });
    expect(banco.linhas('cliente')).toHaveLength(1);
  });

  it('responde 409 quando outro cadastro do mesmo CNPJ chega durante a gravação', async () => {
    const { cadastrar, clienteNovo, proxy, banco, idVendedor } = await montar();
    proxy.responderUmaVez('dados.lote', () => {
      banco.semear('cliente', {
        cnpj: CNPJ,
        razao_social: 'Chegou antes',
        nome_contato: 'Outro',
        tipo_unidade: 'MATRIZ',
        id_operador_vendedor: idVendedor,
        aceite_lgpd: true,
        data_aceite_lgpd: AGORA.toISOString(),
      });
      throw new ErroInterno(new Error('unique violation'));
    });

    const resposta = await cadastrar(clienteNovo());

    expect(resposta.status).toBe(409);
    expect(resposta.body.codigo).toBe('CLIENTE_JA_CADASTRADO');
  });

  it('responde 500 sem detalhe interno quando a gravação falha por outro motivo', async () => {
    const { cadastrar, clienteNovo, proxy } = await montar();
    proxy.responderUmaVez('dados.lote', new ErroInterno(new Error('conexão recusada em 10.0.0.5')));

    const resposta = await cadastrar(clienteNovo());

    expect(resposta.status).toBe(500);
    expect(resposta.body).toEqual({
      codigo: 'INTERNAL_ERROR',
      mensagem: 'Ocorreu um erro interno. Tente novamente em instantes.',
    });
  });

  it('registra o cadastro no log sem CNPJ nem dados de contato', async () => {
    const { cadastrar, clienteNovo, linhas, operador } = await montar();

    await cadastrar(clienteNovo());

    const evento = linhas.find((linha) => linha.evento === 'cliente_cadastrado');
    expect(evento).toMatchObject({ idCliente: 1, idAutor: operador.idOperador });
    const log = JSON.stringify(linhas);
    expect(log).not.toContain(CNPJ);
    expect(log).not.toContain('compras@alfa.com.br');
    expect(log).not.toContain('Marina');
  });
});

describe('GET /clientes/busca (UC03)', () => {
  it('responde 200 com a ficha, aceitando o CNPJ com máscara', async () => {
    const { cadastrar, clienteNovo, buscar } = await montar();
    await cadastrar(clienteNovo());

    const resposta = await buscar(CNPJ_COM_MASCARA);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toMatchObject({
      idCliente: 1,
      cnpj: CNPJ,
      vendedorResponsavel: 'vera',
      enderecos: [{ idEndereco: 1, ...ENDERECO }],
      dividaEmAberto: 0,
    });
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('soma em centavos só as dívidas em aberto e protestadas', async () => {
    const { cadastrar, clienteNovo, buscar, banco, semearUsuario } = await montar();
    await cadastrar(clienteNovo());
    const idFinanceiro = semearUsuario('FINANCEIRO', 'fabio');
    const divida = (valor: string, status: string): Linha => ({
      id_cliente: 1,
      id_operador_registro: idFinanceiro,
      valor_divida: valor,
      status,
      data_vencimento_original: '2026-09-30',
    });
    banco.semear('divida_inadimplencia', [
      divida('1250.10', 'EM_ABERTO'),
      divida('0.20', 'PROTESTADA'),
      divida('900.00', 'RENEGOCIADA'),
      divida('300.00', 'QUITADA'),
    ]);

    const resposta = await buscar(CNPJ);

    expect(resposta.body.dividaEmAberto).toBe(125030);
  });

  it('não lê nem devolve o hash da senha do vendedor', async () => {
    const { cadastrar, clienteNovo, buscar, proxy } = await montar();
    await cadastrar(clienteNovo());

    const resposta = await buscar(CNPJ);

    expect(resposta.text).not.toContain('hash');
    const consultasDeUsuario = proxy
      .chamadasDe('dados.consultar')
      .filter(({ payload }) => payload.tabela === 'operador');
    expect(consultasDeUsuario.every(({ payload }) => Array.isArray(payload.campos))).toBe(true);
    expect(JSON.stringify(consultasDeUsuario)).not.toContain('senha_hash');
  });

  it('responde 404 CLIENTE_NAO_ENCONTRADO quando o CNPJ não está cadastrado', async () => {
    const { buscar } = await montar();

    const resposta = await buscar(CNPJ);

    expect(resposta.status).toBe(404);
    expect(resposta.body).toEqual({
      codigo: 'CLIENTE_NAO_ENCONTRADO',
      mensagem: 'Nenhum cliente cadastrado com este CNPJ.',
    });
  });

  it.each([
    ['ausente', ''],
    ['com 13 dígitos', '?cnpj=1122233300018'],
    ['com letras', '?cnpj=abc'],
    ['repetido', `?cnpj=${CNPJ}&cnpj=${CNPJ}`],
  ])('responde 400 com o CNPJ %s', async (_caso, consulta) => {
    const { app, operador } = await montar();

    const resposta = await request(app)
      .get(`/clientes/busca${consulta}`)
      .set('Authorization', operador.autorizacao);

    expect(resposta.status).toBe(400);
    expect(resposta.body.detalhes).toEqual({ campos: ['cnpj'] });
  });
});

describe('GET /clientes/:id/orcamentos-em-aberto e /historico-compras', () => {
  it.each(['orcamentos-em-aberto', 'historico-compras'])(
    '%s responde 200 com lista vazia quando o cliente não tem orçamentos',
    async (rota) => {
      const { app, operador, cadastrar, clienteNovo } = await montar();
      await cadastrar(clienteNovo());

      const resposta = await request(app)
        .get(`/clientes/1/${rota}`)
        .set('Authorization', operador.autorizacao);

      expect(resposta.status).toBe(200);
      expect(resposta.body).toEqual([]);
    },
  );

  it('orcamentos-em-aberto só traz RASCUNHO, PENDENTE_CREDITO, ABERTO e ALTERACAO_SOLICITADA (RF04)', async () => {
    const { app, operador, cadastrar, clienteNovo, banco } = await montar();
    await cadastrar(clienteNovo());
    const idOperador = operador.idOperador;
    const abertos = ['RASCUNHO', 'PENDENTE_CREDITO', 'ABERTO', 'ALTERACAO_SOLICITADA'];
    const encerrados = ['ACEITO', 'RECUSADO', 'CANCELADO', 'SUBSTITUIDO', 'EXPIRADO'];
    for (const status of [...abertos, ...encerrados]) {
      banco.semear('orcamento', { id_cliente: 1, id_operador: idOperador, status });
    }

    const resposta = await request(app)
      .get('/clientes/1/orcamentos-em-aberto')
      .set('Authorization', operador.autorizacao);

    expect(resposta.status).toBe(200);
    expect((resposta.body as { status: string }[]).map((o) => o.status).sort()).toEqual(
      [...abertos].sort(),
    );
  });

  it('historico-compras só traz orçamentos ACEITO, com o número e o valor total como aceito (RF04/RF07)', async () => {
    const { app, operador, cadastrar, clienteNovo, banco } = await montar();
    await cadastrar(clienteNovo());
    banco.semear('orcamento', {
      id_cliente: 1,
      id_operador: operador.idOperador,
      status: 'ACEITO',
      numero_orcamento: 42,
      data_emissao: '2026-10-01',
      valor_total_proposta: '350.00',
    });
    banco.semear('orcamento', {
      id_cliente: 1,
      id_operador: operador.idOperador,
      status: 'ABERTO',
    });

    const resposta = await request(app)
      .get('/clientes/1/historico-compras')
      .set('Authorization', operador.autorizacao);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual([
      { idOrcamento: 1, numeroOrcamento: 42, dataEmissao: '2026-10-01', valorTotalAceito: 35000 },
    ]);
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])(
    'responde 400 com o identificador "%s"',
    async (id) => {
      const { app, operador } = await montar();

      const resposta = await request(app)
        .get(`/clientes/${id}/historico-compras`)
        .set('Authorization', operador.autorizacao);

      expect(resposta.status).toBe(400);
      expect(resposta.body.detalhes).toEqual({ campos: ['id'] });
    },
  );
});

describe('GET /vendedores', () => {
  it('lista só os vendedores ativos, em ordem alfabética, sem dados além do id e do nome', async () => {
    const { app, operador, semearUsuario, idVendedor } = await montar();
    const idAna = semearUsuario('VENDEDOR', 'ana');
    semearUsuario('VENDEDOR', 'ivo', 'INATIVO');
    semearUsuario('GESTOR', 'gil');

    const resposta = await request(app)
      .get('/vendedores')
      .set('Authorization', operador.autorizacao);

    expect(resposta.status).toBe(200);
    expect(resposta.body).toEqual([
      { idOperador: idAna, nome: 'ana' },
      { idOperador: idVendedor, nome: 'vera' },
    ]);
  });
});

describe('autorização das rotas de clientes', () => {
  const ROTAS = [
    ['get', `/clientes/busca?cnpj=${CNPJ}`],
    ['post', '/clientes'],
    ['get', '/clientes/1/orcamentos-em-aberto'],
    ['get', '/clientes/1/historico-compras'],
    ['get', '/vendedores'],
  ] as const;

  it.each(ROTAS)('%s %s responde 401 sem sessão', async (metodo, rota) => {
    const { app } = await montar();

    const resposta = await request(app)[metodo](rota);

    expect(resposta.status).toBe(401);
    expect(resposta.body.codigo).toBe('NAO_AUTENTICADO');
  });

  it.each(ROTAS)('%s %s responde 403 para o perfil FISCAL', async (metodo, rota) => {
    const { app, entrarComo } = await montar();
    const fiscal = await entrarComo('FISCAL');

    const resposta = await request(app)[metodo](rota).set('Authorization', fiscal.autorizacao);

    expect(resposta.status).toBe(403);
    expect(resposta.body.codigo).toBe('ACESSO_NEGADO');
  });

  it.each(['VENDEDOR', 'FINANCEIRO', 'GESTOR'] as const)(
    'o perfil %s não consulta clientes',
    async (perfil) => {
      const { buscar, entrarComo } = await montar();
      const usuario = await entrarComo(perfil, `usuario_${perfil.toLowerCase()}`);

      expect((await buscar(CNPJ, usuario.autorizacao)).status).toBe(403);
    },
  );

  it('o operador chefe cadastra e consulta', async () => {
    const { cadastrar, clienteNovo, buscar, entrarComo } = await montar();
    const chefe = await entrarComo('OPERADOR_CHEFE');

    expect((await cadastrar(clienteNovo(), chefe.autorizacao)).status).toBe(201);
    expect((await buscar(CNPJ, chefe.autorizacao)).status).toBe(200);
  });
});
