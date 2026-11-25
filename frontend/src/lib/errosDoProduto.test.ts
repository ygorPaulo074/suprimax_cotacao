import {
  caminhoDaFaixa,
  caminhoDaVariacao,
  caminhoDoFardo,
  descreverCampo,
  resumoDosCampos,
} from './errosDoProduto';

const VALIDACAO = 'VALIDATION_ERROR';

describe('caminhos do formulário', () => {
  it('seguem o formato que o backend envia em detalhes.campos', () => {
    expect(caminhoDaVariacao(0, 'quantidadeEstoque')).toBe('variacoes.0.quantidadeEstoque');
    expect(caminhoDaFaixa(1, 2, 'precoUnitario')).toBe('variacoes.1.faixasPreco.2.precoUnitario');
    expect(caminhoDoFardo(0, 0, 'quantidadeUnidades')).toBe(
      'variacoes.0.fardos.0.quantidadeUnidades',
    );
  });
});

describe('descreverCampo', () => {
  it.each([
    ['ncm', 'NCM', 'O NCM tem 8 dígitos.'],
    ['ean', 'EAN', 'O EAN tem de 8 a 14 dígitos.'],
    ['categoria', 'Categoria', 'Até 60 caracteres.'],
    ['codigoInterno', 'Código interno', 'Obrigatório, até 30 caracteres.'],
    [
      'variacoes.0.quantidadeEstoque',
      'Quantidade em estoque (variação 1)',
      'Número inteiro de 0 a 2.147.483.647.',
    ],
    [
      'variacoes.2.faixasPreco.1.quantidadeMinima',
      'Qtd. mínima (faixa 2, variação 3)',
      'Inteiro maior que zero, sem repetir nas faixas.',
    ],
    [
      'variacoes.0.fardos.0.precoFixo',
      'Preço fixo (fardo 1, variação 1)',
      'Informe um valor válido, como 0,00.',
    ],
    ['variacoes.1.idVariacao', 'Variação 2', 'Variação repetida.'],
    ['variacoes', 'Variações', 'No máximo 12 variações novas por gravação.'],
  ])('%s', (caminho, rotulo, dica) => {
    expect(descreverCampo(caminho, VALIDACAO)).toEqual({ rotulo, dica });
  });

  it('em duplicidade, a dica fala do código e do EAN já cadastrados', () => {
    expect(descreverCampo('codigoInterno', 'PRODUTO_JA_CADASTRADO').dica).toBe(
      'Já existe um produto com este código interno.',
    );
    expect(descreverCampo('ean', 'PRODUTO_JA_CADASTRADO').dica).toBe(
      'Já existe um produto com este EAN.',
    );
  });

  it.each(['campo.desconhecido', 'variacoes.x.marca', 'variacoes.0.faixasPreco.y.precoUnitario'])(
    'caminho que não reconhece (%s) aparece como veio, com dica genérica',
    (caminho) => {
      expect(descreverCampo(caminho, VALIDACAO)).toEqual({
        rotulo: caminho,
        dica: 'Valor inválido.',
      });
    },
  );
});

describe('resumoDosCampos', () => {
  it('lista os campos a corrigir na ordem recebida', () => {
    expect(resumoDosCampos(['ncm', 'variacoes.0.quantidadeEstoque'], VALIDACAO)).toBe(
      'Corrija os campos destacados: NCM; Quantidade em estoque (variação 1).',
    );
  });
});
