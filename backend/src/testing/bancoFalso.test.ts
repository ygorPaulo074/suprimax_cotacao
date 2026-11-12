import { ErroProxy } from '../dados/proxyCliente';
import { ErroDeValidacao, ErroInterno } from '../erros';
import { BancoFalso, type Linha } from './bancoFalso';
import { ProxyClienteFalso } from './proxyClienteFalso';

const AGORA = new Date('2026-11-11T15:00:00Z');

function montar() {
  const banco = new BancoFalso({ agora: () => AGORA });
  const operador = (usuario: string, perfil = 'VENDEDOR'): Linha => ({
    usuario,
    email: `${usuario}@suprimax.com.br`,
    senha_hash: 'hash',
    perfil,
  });
  banco.semear('operador', [operador('ana'), operador('bia'), operador('caio', 'OPERADOR')]);
  const cliente = (cnpj: string, razaoSocial: string, idVendedor: number): Linha => ({
    cnpj,
    razao_social: razaoSocial,
    nome_contato: 'Contato',
    tipo_unidade: 'MATRIZ',
    id_operador_vendedor: idVendedor,
    aceite_lgpd: true,
    data_aceite_lgpd: AGORA.toISOString(),
  });
  banco.semear('cliente', [
    cliente('11111111000111', 'Papelaria Alfa', 1),
    cliente('22222222000122', 'Mercado Beta', 1),
    cliente('33333333000133', 'Escola Gama', 2),
  ]);
  return { banco, cliente };
}

function codigoDe(acao: () => unknown): string | undefined {
  try {
    acao();
  } catch (erro) {
    return erro instanceof ErroProxy ? erro.codigo : `outro: ${String(erro)}`;
  }
  return undefined;
}

describe('BancoFalso — dados.consultar', () => {
  it('aplica valores padrão e gera a chave primária em sequência', () => {
    const { banco } = montar();

    expect(banco.linhas('operador').map((linha) => linha.id_operador)).toEqual([1, 2, 3]);
    expect(banco.linhas('cliente')[0]).toMatchObject({
      id_cliente: 1,
      status: 'ATIVO',
      data_cadastro: AGORA.toISOString(),
      nome_fantasia: null,
    });
  });

  it.each([
    ['igualdade', { e: [['id_operador_vendedor', '=', 1]] }, [1, 2]],
    ['diferença', { e: [['id_operador_vendedor', '!=', 1]] }, [3]],
    ['lista (em)', { e: [['id_cliente', 'em', [1, 3]]] }, [1, 3]],
    ['texto parcial sem diferenciar maiúsculas', { e: [['razao_social', 'contem', 'BETA']] }, [2]],
    ['nulo', { e: [['nome_fantasia', 'nulo']] }, [1, 2, 3]],
    ['não nulo', { e: [['nome_fantasia', 'nao_nulo']] }, []],
    ['maior que', { e: [['id_cliente', '>', 1]] }, [2, 3]],
    [
      'grupo "ou" dentro de "e"',
      {
        e: [
          ['id_operador_vendedor', '=', 1],
          {
            ou: [
              ['id_cliente', '=', 2],
              ['id_cliente', '=', 3],
            ],
          },
        ],
      },
      [2],
    ],
  ])('filtra por %s', (_caso, filtros, esperados) => {
    const { banco } = montar();

    const { dados } = banco.executar('dados.consultar', { tabela: 'cliente', filtros });

    expect((dados as Linha[]).map((linha) => linha.id_cliente)).toEqual(esperados);
  });

  it('devolve só os campos pedidos e ordena por qualquer coluna da tabela', () => {
    const { banco } = montar();

    const { dados } = banco.executar('dados.consultar', {
      tabela: 'cliente',
      campos: ['cnpj'],
      ordenacao: [['razao_social', 'asc']],
    });

    expect(dados).toEqual([
      { cnpj: '33333333000133' },
      { cnpj: '22222222000122' },
      { cnpj: '11111111000111' },
    ]);
  });

  it('inclui as linhas filhas em lista e a linha pai em objeto', () => {
    const { banco } = montar();
    banco.semear('endereco_cliente', {
      id_cliente: 1,
      tipo: 'CADASTRAL',
      logradouro: 'Rua 1',
      numero: '10',
      bairro: 'Centro',
      cidade: 'Goiânia',
      uf: 'GO',
      cep: '74000000',
    });

    const filhas = banco.executar('dados.consultar', {
      tabela: 'cliente',
      campos: ['id_cliente'],
      incluir: ['endereco_cliente'],
    }).dados as Linha[];
    const pai = banco.executar('dados.consultar', {
      tabela: 'cliente',
      campos: ['id_cliente'],
      filtros: { e: [['id_cliente', '=', 3]] },
      incluir: ['operador'],
    }).dados as Linha[];

    expect(filhas.map((linha) => (linha.endereco_cliente as Linha[]).length)).toEqual([1, 0, 0]);
    expect(pai[0]?.operador).toMatchObject({ id_operador: 2, usuario: 'bia' });
  });

  it('pagina com cursor até a última página', () => {
    const { banco } = montar();

    const primeira = banco.executar('dados.consultar', { tabela: 'cliente', limite: 2 });
    const segunda = banco.executar('dados.consultar', {
      tabela: 'cliente',
      limite: 2,
      cursor: primeira.proximo_cursor,
    });

    expect((primeira.dados as Linha[]).map((linha) => linha.id_cliente)).toEqual([1, 2]);
    expect(primeira.proximo_cursor).toEqual(expect.any(String));
    expect((segunda.dados as Linha[]).map((linha) => linha.id_cliente)).toEqual([3]);
    expect(segunda.proximo_cursor).toBeNull();
  });

  it('conta por grupo e soma DECIMAL sem ponto flutuante', () => {
    const { banco } = montar();
    banco.semear('operador', {
      usuario: 'fin',
      email: 'fin@suprimax.com.br',
      senha_hash: 'hash',
      perfil: 'FINANCEIRO',
    });
    const divida = (valor: string, status = 'EM_ABERTO'): Linha => ({
      id_cliente: 1,
      id_operador_registro: 4,
      valor_divida: valor,
      status,
      data_vencimento_original: '2026-10-01',
    });
    banco.semear('divida_inadimplencia', [
      divida('0.10'),
      divida('0.20'),
      divida('5.00', 'QUITADA'),
    ]);

    const contagem = banco.executar('dados.consultar', {
      tabela: 'cliente',
      agrupar: ['id_operador_vendedor'],
      agregacoes: [{ fn: 'contar', campo: '*', como: 'total' }],
      ordenacao: [['id_operador_vendedor', 'asc']],
    });
    const soma = banco.executar('dados.consultar', {
      tabela: 'divida_inadimplencia',
      filtros: { e: [['status', '=', 'EM_ABERTO']] },
      agregacoes: [{ fn: 'soma', campo: 'valor_divida', como: 'total' }],
    });
    const somaVazia = banco.executar('dados.consultar', {
      tabela: 'divida_inadimplencia',
      filtros: { e: [['id_cliente', '=', 99]] },
      agregacoes: [{ fn: 'soma', campo: 'valor_divida', como: 'total' }],
    });

    expect(contagem.dados).toEqual([
      { id_operador_vendedor: 1, total: 2 },
      { id_operador_vendedor: 2, total: 1 },
    ]);
    expect(soma.dados).toEqual([{ total: '0.30' }]);
    expect(somaVazia.dados).toEqual([{ total: null }]);
  });
});

describe('BancoFalso — restrições', () => {
  it.each([
    ['tabela inexistente', 'dados.consultar', { tabela: 'nada' }, 'PAYLOAD_INVALIDO'],
    [
      'coluna inexistente no filtro',
      'dados.consultar',
      { tabela: 'cliente', filtros: { e: [['nada', '=', 1]] } },
      'PAYLOAD_INVALIDO',
    ],
    [
      'limite acima do máximo',
      'dados.consultar',
      { tabela: 'cliente', limite: 501 },
      'PAYLOAD_INVALIDO',
    ],
    [
      'coluna obrigatória ausente',
      'dados.inserir',
      { tabela: 'fornecedor', valores: { cnpj: '44444444000144' } },
      'INTERNAL_ERROR',
    ],
    [
      'valor único repetido',
      'dados.atualizar',
      {
        tabela: 'cliente',
        filtros: { e: [['id_cliente', '=', 2]] },
        valores: { cnpj: '11111111000111' },
      },
      'INTERNAL_ERROR',
    ],
    [
      'chave estrangeira sem registro',
      'dados.atualizar',
      {
        tabela: 'cliente',
        filtros: { e: [['id_cliente', '=', 2]] },
        valores: { id_operador_vendedor: 99 },
      },
      'INTERNAL_ERROR',
    ],
    [
      'exclusão de registro referenciado',
      'dados.excluir',
      { tabela: 'operador', filtros: { e: [['id_operador', '=', 1]] } },
      'INTERNAL_ERROR',
    ],
    [
      'atualização sem filtro',
      'dados.atualizar',
      { tabela: 'cliente', valores: { status: 'INATIVO' } },
      'RISCO_ESTRUTURAL',
    ],
    [
      'alteração de chave primária',
      'dados.atualizar',
      { tabela: 'cliente', filtros: { e: [['id_cliente', '=', 1]] }, valores: { id_cliente: 9 } },
      'RISCO_ESTRUTURAL',
    ],
    ['operação desconhecida', 'dados.apagar_tudo', {}, 'OPERACAO_DESCONHECIDA'],
  ])('recusa %s', (_caso, operacao, payload, codigo) => {
    const { banco } = montar();

    expect(codigoDe(() => banco.executar(operacao, payload))).toBe(codigo);
  });

  it('bloqueia a gravação que afetaria mais de 50 linhas', () => {
    const { banco, cliente } = montar();
    const muitos = Array.from({ length: 51 }, (_, i) =>
      cliente(String(50000000000000 + i), `Cliente ${i}`, 2),
    );
    banco.semear('cliente', muitos);

    const codigo = codigoDe(() =>
      banco.executar('dados.atualizar', {
        tabela: 'cliente',
        filtros: { e: [['id_operador_vendedor', '=', 2]] },
        valores: { id_operador_vendedor: 1 },
      }),
    );

    expect(codigo).toBe('RISCO_ESTRUTURAL');
    expect(
      banco.linhas('cliente').filter((linha) => linha.id_operador_vendedor === 2),
    ).toHaveLength(52);
  });
});

describe('BancoFalso — dados.lote', () => {
  const passos = (cnpjDoSegundo: string) => ({
    passos: [
      {
        id: 'primeiro',
        operacao: 'dados.inserir',
        payload: {
          tabela: 'fornecedor',
          valores: { cnpj: '44444444000144', razao_social: 'Fornecedor A' },
          retornar: ['id_fornecedor'],
        },
      },
      {
        id: 'segundo',
        operacao: 'dados.inserir',
        payload: {
          tabela: 'fornecedor',
          valores: { cnpj: cnpjDoSegundo, razao_social: 'Fornecedor B' },
        },
      },
    ],
  });

  it('executa os passos e troca a referência pelo resultado de um passo anterior', () => {
    const { banco } = montar();

    const { resultados } = banco.executar('dados.lote', {
      passos: [
        {
          id: 'cliente',
          operacao: 'dados.consultar',
          payload: {
            tabela: 'cliente',
            campos: ['id_cliente'],
            filtros: { e: [['cnpj', '=', '33333333000133']] },
          },
        },
        {
          id: 'endereco',
          operacao: 'dados.inserir',
          payload: {
            tabela: 'endereco_cliente',
            valores: {
              id_cliente: '$cliente.dados[0].id_cliente',
              tipo: 'ENTREGA',
              logradouro: 'Rua 2',
              numero: 'S/N',
              bairro: 'Centro',
              cidade: 'Goiânia',
              uf: 'GO',
              cep: '74000000',
            },
          },
        },
      ],
    });

    expect(Object.keys(resultados as object)).toEqual(['cliente', 'endereco']);
    expect(banco.linhas('endereco_cliente')[0]).toMatchObject({ id_cliente: 3, tipo: 'ENTREGA' });
  });

  it('desfaz todos os passos quando um deles falha', () => {
    const { banco } = montar();

    expect(codigoDe(() => banco.executar('dados.lote', passos('44444444000144')))).toBe(
      'INTERNAL_ERROR',
    );
    expect(banco.linhas('fornecedor')).toEqual([]);

    banco.executar('dados.lote', passos('55555555000155'));
    expect(banco.linhas('fornecedor').map((linha) => linha.id_fornecedor)).toEqual([1, 2]);
  });

  it.each([
    ['sem passos', { passos: [] }],
    [
      'com mais de 20 passos',
      {
        passos: Array.from({ length: 21 }, (_, i) => ({
          id: `p${i}`,
          operacao: 'dados.consultar',
          payload: { tabela: 'cliente' },
        })),
      },
    ],
    [
      'com operação que não é dados.*',
      { passos: [{ id: 'p', operacao: 'pedido.assumir', payload: {} }] },
    ],
    [
      'com id de passo fora do padrão',
      { passos: [{ id: 'Passo-1', operacao: 'dados.consultar', payload: { tabela: 'cliente' } }] },
    ],
    [
      'com referência a passo inexistente',
      {
        passos: [
          {
            id: 'p',
            operacao: 'dados.consultar',
            payload: { tabela: 'cliente', filtros: { e: [['id_cliente', '=', '$x.dados[0].id']] } },
          },
        ],
      },
    ],
  ])('recusa o lote %s', (_caso, payload) => {
    const { banco } = montar();

    expect(codigoDe(() => banco.executar('dados.lote', payload))).toBe('PAYLOAD_INVALIDO');
  });
});

describe('BancoFalso — instalado no dublê do proxy', () => {
  it('responde em camelCase, como o cliente real, mantendo os ids dos passos do lote', async () => {
    const { banco } = montar();
    const proxy = new ProxyClienteFalso();
    banco.instalarEm(proxy);

    const consulta = await proxy.executar(
      'dados.consultar',
      { tabela: 'cliente', limite: 1 },
      'teste',
    );
    const lote = await proxy.executar(
      'dados.lote',
      {
        passos: [
          {
            id: 'passo_um',
            operacao: 'dados.consultar',
            payload: { tabela: 'cliente', campos: ['id_cliente'], limite: 1 },
          },
        ],
      },
      'teste',
    );

    expect(consulta).toMatchObject({
      ok: true,
      dados: [{ idCliente: 1, razaoSocial: 'Papelaria Alfa' }],
    });
    expect(consulta).toHaveProperty('proximoCursor', expect.any(String));
    expect(lote).toEqual({
      ok: true,
      resultados: {
        passo_um: { ok: true, dados: [{ idCliente: 1 }], proximoCursor: expect.any(String) },
      },
    });
  });

  it.each([
    [
      'violação de restrição vira erro interno',
      'dados.inserir',
      { tabela: 'fornecedor', valores: { cnpj: '1' } },
      ErroInterno,
    ],
    [
      'payload inválido vira erro de validação',
      'dados.consultar',
      { tabela: 'nada' },
      ErroDeValidacao,
    ],
  ])('traduz os erros do proxy: %s', async (_caso, operacao, payload, classe) => {
    const { banco } = montar();
    const proxy = new ProxyClienteFalso();
    banco.instalarEm(proxy);

    await expect(proxy.executar(operacao, payload, 'teste')).rejects.toBeInstanceOf(classe);
  });
});
