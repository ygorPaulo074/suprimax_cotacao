import type { DadosDoProduto } from './esquemas';
import { planejarAtualizacao, planoEstaVazio, type PlanoDeAtualizacao } from './plano';
import type { Produto } from './repositorio';

const GRAVADO: Produto = {
  idProduto: 7,
  codigoInterno: 'PAP-001',
  descricao: 'Papel sulfite A4',
  ncm: '48025610',
  ean: null,
  categoria: 'Papelaria',
  ativo: true,
  variacoes: [
    {
      idVariacao: 10,
      marca: 'Chamex',
      tamanhoEmbalagem: '500 folhas',
      quantidadeEstoque: 40,
      saldoDisponivel: 40,
      faixasPreco: [
        { idFaixaPreco: 100, quantidadeMinima: 1, precoUnitario: 2500 },
        { idFaixaPreco: 101, quantidadeMinima: 4, precoUnitario: 1900 },
      ],
      fardos: [{ idFardo: 200, quantidadeUnidades: 10, precoFixo: 17000 }],
    },
    {
      idVariacao: 11,
      marca: 'Report',
      tamanhoEmbalagem: '500 folhas',
      quantidadeEstoque: 0,
      saldoDisponivel: 0,
      faixasPreco: [{ idFaixaPreco: 102, quantidadeMinima: 1, precoUnitario: 2300 }],
      fardos: [],
    },
  ],
};

/** Corpo do PUT que repete exatamente o que está gravado, sem tocar nos preços. */
function pedido(alteracoes: Partial<DadosDoProduto> = {}): DadosDoProduto {
  return {
    codigoInterno: GRAVADO.codigoInterno,
    descricao: GRAVADO.descricao,
    ncm: GRAVADO.ncm,
    ean: GRAVADO.ean,
    categoria: GRAVADO.categoria,
    ativo: GRAVADO.ativo,
    variacoes: GRAVADO.variacoes.map(({ idVariacao, marca, tamanhoEmbalagem }) => ({
      idVariacao,
      marca,
      tamanhoEmbalagem,
    })),
    ...alteracoes,
  };
}

/** Variações do pedido com a primeira alterada. */
function comAPrimeira(alteracoes: Partial<DadosDoProduto['variacoes'][number]>) {
  const [primeira, ...demais] = pedido().variacoes;
  return pedido({ variacoes: [{ ...primeira!, ...alteracoes }, ...demais] });
}

const VAZIO: Omit<PlanoDeAtualizacao, 'idProduto'> = {
  variacoesNovas: [],
  variacoesAlteradas: [],
  variacoesRemovidas: [],
  faixasNovas: [],
  faixasAlteradas: [],
  idsDasFaixasRemovidas: [],
  fardosNovos: [],
  fardosAlterados: [],
  idsDosFardosRemovidos: [],
};

describe('planejarAtualizacao', () => {
  it('não planeja nada quando o pedido repete o que está gravado', () => {
    const plano = planejarAtualizacao(GRAVADO, pedido());

    expect(plano).toEqual({ idProduto: 7, ...VAZIO });
    expect(planoEstaVazio(plano)).toBe(true);
  });

  it('não planeja nada quando os preços enviados são iguais aos gravados, em qualquer ordem', () => {
    const plano = planejarAtualizacao(
      GRAVADO,
      comAPrimeira({
        faixasPreco: [
          { quantidadeMinima: 4, precoUnitario: 1900 },
          { quantidadeMinima: 1, precoUnitario: 2500 },
        ],
        fardos: [{ quantidadeUnidades: 10, precoFixo: 17000 }],
      }),
    );

    expect(planoEstaVazio(plano)).toBe(true);
  });

  it.each<[string, DadosDoProduto, Partial<PlanoDeAtualizacao>]>([
    [
      'campo do produto alterado: grava todos os campos do produto',
      pedido({ descricao: 'Papel sulfite A4 75g', ean: '7891234567895', ativo: false }),
      {
        produto: {
          codigoInterno: 'PAP-001',
          descricao: 'Papel sulfite A4 75g',
          ncm: '48025610',
          ean: '7891234567895',
          categoria: 'Papelaria',
          ativo: false,
        },
      },
    ],
    [
      'marca ou tamanho da variação alterados',
      comAPrimeira({ tamanhoEmbalagem: 'Resma 500 fls' }),
      {
        variacoesAlteradas: [
          { idVariacao: 10, marca: 'Chamex', tamanhoEmbalagem: 'Resma 500 fls' },
        ],
      },
    ],
    [
      'preço de faixa alterado: mantém o identificador da faixa',
      comAPrimeira({
        faixasPreco: [
          { quantidadeMinima: 1, precoUnitario: 2600 },
          { quantidadeMinima: 4, precoUnitario: 1900 },
        ],
      }),
      { faixasAlteradas: [{ idFaixaPreco: 100, precoUnitario: 2600 }] },
    ],
    [
      'faixa nova, faixa removida e faixa mantida na mesma variação',
      comAPrimeira({
        faixasPreco: [
          { quantidadeMinima: 1, precoUnitario: 2500 },
          { quantidadeMinima: 12, precoUnitario: 1700 },
        ],
      }),
      {
        faixasNovas: [{ idVariacao: 10, quantidadeMinima: 12, precoUnitario: 1700 }],
        idsDasFaixasRemovidas: [101],
      },
    ],
    [
      'lista de faixas vazia: remove todas as faixas da variação',
      comAPrimeira({ faixasPreco: [] }),
      { idsDasFaixasRemovidas: [100, 101] },
    ],
    [
      'fardo alterado, fardo novo e fardo removido',
      comAPrimeira({
        fardos: [
          { quantidadeUnidades: 6, precoFixo: 11000 },
          { quantidadeUnidades: 12, precoFixo: 20000 },
        ],
      }),
      {
        fardosNovos: [
          { idVariacao: 10, quantidadeUnidades: 6, precoFixo: 11000 },
          { idVariacao: 10, quantidadeUnidades: 12, precoFixo: 20000 },
        ],
        idsDosFardosRemovidos: [200],
      },
    ],
    [
      'preço de fardo alterado: mantém o identificador do fardo',
      comAPrimeira({ fardos: [{ quantidadeUnidades: 10, precoFixo: 16500 }] }),
      { fardosAlterados: [{ idFardo: 200, precoFixo: 16500 }] },
    ],
    [
      'variação sem identificador: é criada com seus preços e estoque zero por padrão',
      pedido({
        variacoes: [
          ...pedido().variacoes,
          {
            marca: 'Chamex',
            tamanhoEmbalagem: '100 folhas',
            faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 700 }],
          },
        ],
      }),
      {
        variacoesNovas: [
          {
            marca: 'Chamex',
            tamanhoEmbalagem: '100 folhas',
            quantidadeEstoque: 0,
            faixasPreco: [{ quantidadeMinima: 1, precoUnitario: 700 }],
            fardos: [],
          },
        ],
      },
    ],
    [
      'variação gravada que não veio no pedido: é removida com os preços dela',
      pedido({ variacoes: pedido().variacoes.slice(1) }),
      { variacoesRemovidas: [{ idVariacao: 10, idsDasFaixas: [100, 101], idsDosFardos: [200] }] },
    ],
    [
      'pedido sem variações: remove todas',
      pedido({ variacoes: [] }),
      {
        variacoesRemovidas: [
          { idVariacao: 10, idsDasFaixas: [100, 101], idsDosFardos: [200] },
          { idVariacao: 11, idsDasFaixas: [102], idsDosFardos: [] },
        ],
      },
    ],
  ])('%s', (_caso, corpo, esperado) => {
    const plano = planejarAtualizacao(GRAVADO, corpo);

    expect(plano).toEqual({ idProduto: 7, ...VAZIO, ...esperado });
    expect(planoEstaVazio(plano)).toBe(false);
  });

  it('remove as faixas gravadas com quantidade repetida, mantendo a primeira', () => {
    const [primeira, segunda] = GRAVADO.variacoes;
    const comRepetida: Produto = {
      ...GRAVADO,
      variacoes: [
        {
          ...primeira!,
          faixasPreco: [
            ...primeira!.faixasPreco,
            { idFaixaPreco: 109, quantidadeMinima: 4, precoUnitario: 1800 },
          ],
        },
        segunda!,
      ],
    };

    const plano = planejarAtualizacao(
      comRepetida,
      comAPrimeira({
        faixasPreco: [
          { quantidadeMinima: 1, precoUnitario: 2500 },
          { quantidadeMinima: 4, precoUnitario: 1900 },
        ],
      }),
    );

    expect(plano).toEqual({ idProduto: 7, ...VAZIO, idsDasFaixasRemovidas: [109] });
  });
});
