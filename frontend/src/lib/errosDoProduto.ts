// UC04 — nomes e dicas dos campos do cadastro de produto, para mostrar qual dado o backend recusou.
// As regras espelham backend/src/modulos/produtos/esquemas.ts; o backend continua sendo quem decide.

const ROTULOS: Readonly<Record<string, string>> = {
  codigoInterno: 'Código interno',
  descricao: 'Descrição',
  ncm: 'NCM',
  ean: 'EAN',
  categoria: 'Categoria',
  marca: 'Marca',
  tamanhoEmbalagem: 'Tamanho/embalagem',
  quantidadeEstoque: 'Quantidade em estoque',
  quantidadeMinima: 'Qtd. mínima',
  precoUnitario: 'Preço unitário',
  quantidadeUnidades: 'Unidades',
  precoFixo: 'Preço fixo',
};

const DICAS: Readonly<Record<string, string>> = {
  codigoInterno: 'Obrigatório, até 30 caracteres.',
  descricao: 'Obrigatória, até 200 caracteres.',
  ncm: 'O NCM tem 8 dígitos.',
  ean: 'O EAN tem de 8 a 14 dígitos.',
  categoria: 'Até 60 caracteres.',
  marca: 'Obrigatória, até 60 caracteres.',
  tamanhoEmbalagem: 'Obrigatório, até 40 caracteres, sem repetir marca e embalagem.',
  quantidadeEstoque: 'Número inteiro de 0 a 2.147.483.647.',
  quantidadeMinima: 'Inteiro maior que zero, sem repetir nas faixas.',
  precoUnitario: 'Informe um valor válido, como 0,00.',
  quantidadeUnidades: 'Inteiro maior que zero, sem repetir nos fardos.',
  precoFixo: 'Informe um valor válido, como 0,00.',
};

/** Variações novas aceitas em uma gravação (MAXIMO_DE_VARIACOES_NOVAS_POR_GRAVACAO, no backend). */
const MAXIMO_DE_VARIACOES_NOVAS = 12;

const CODIGO_DE_DUPLICIDADE = 'PRODUTO_JA_CADASTRADO';

/** Caminhos que o backend usa para cada campo do formulário (`variacoes.0.faixasPreco.1.precoUnitario`). */
export const caminhoDoProduto = (campo: string) => campo;
export const caminhoDaVariacao = (variacao: number, campo: string) =>
  `variacoes.${variacao}.${campo}`;
export const caminhoDaFaixa = (variacao: number, faixa: number, campo: string) =>
  `variacoes.${variacao}.faixasPreco.${faixa}.${campo}`;
export const caminhoDoFardo = (variacao: number, fardo: number, campo: string) =>
  `variacoes.${variacao}.fardos.${fardo}.${campo}`;

export interface CampoDescrito {
  /** Nome do campo como a tela o mostra, com a posição quando é de variação, faixa ou fardo. */
  readonly rotulo: string;
  /** O que o campo exige; aparece sob o campo marcado. */
  readonly dica: string;
}

const posicao = (texto: string | undefined): number | null => {
  const n = Number(texto);
  return texto !== undefined && Number.isInteger(n) && n >= 0 ? n + 1 : null;
};

/**
 * Descreve um caminho recusado pelo backend.
 *
 * @param codigo Código do erro; em `PRODUTO_JA_CADASTRADO` o campo existe, mas o problema é a duplicidade.
 */
export function descreverCampo(caminho: string, codigo: string): CampoDescrito {
  const partes = caminho.split('.');
  const nome = partes[partes.length - 1] ?? caminho;
  const rotuloBase = ROTULOS[nome];
  const dicaBase =
    codigo === CODIGO_DE_DUPLICIDADE
      ? nome === 'ean'
        ? 'Já existe um produto com este EAN.'
        : 'Já existe um produto com este código interno.'
      : DICAS[nome];

  if (partes[0] !== 'variacoes') {
    return { rotulo: rotuloBase ?? caminho, dica: dicaBase ?? 'Valor inválido.' };
  }
  if (partes.length === 1) {
    return {
      rotulo: 'Variações',
      dica: `No máximo ${MAXIMO_DE_VARIACOES_NOVAS} variações novas por gravação.`,
    };
  }
  const variacao = posicao(partes[1]);
  if (variacao === null) return { rotulo: caminho, dica: 'Valor inválido.' };
  if (nome === 'idVariacao') return { rotulo: `Variação ${variacao}`, dica: 'Variação repetida.' };
  if (rotuloBase === undefined || dicaBase === undefined) {
    return { rotulo: caminho, dica: 'Valor inválido.' };
  }
  if (partes[2] === 'faixasPreco' || partes[2] === 'fardos') {
    const item = posicao(partes[3]);
    if (item === null) return { rotulo: caminho, dica: 'Valor inválido.' };
    const lugar = partes[2] === 'faixasPreco' ? `faixa ${item}` : `fardo ${item}`;
    return { rotulo: `${rotuloBase} (${lugar}, variação ${variacao})`, dica: dicaBase };
  }
  return { rotulo: `${rotuloBase} (variação ${variacao})`, dica: dicaBase };
}

/** Frase do alerta: lista os campos a corrigir, na ordem em que o backend os enviou. */
export function resumoDosCampos(caminhos: Iterable<string>, codigo: string): string {
  const rotulos = [...caminhos].map((c) => descreverCampo(c, codigo).rotulo);
  return `Corrija os campos destacados: ${rotulos.join('; ')}.`;
}
