// UC04 — formato do corpo e dos parâmetros das rotas de produtos. Tamanhos: docs/13, seções
// 13.7.4 a 13.7.7.
import { z } from 'zod';
import {
  digitosOpcionais,
  esquemaDeCentavos,
  esquemaDeId,
  esquemaDeQuantidade,
  MAIOR_INTEIRO_DO_BANCO,
  textoObrigatorio,
  textoOpcional,
} from '../comum/campos';

export const TAMANHO_MAXIMO_DO_CODIGO_INTERNO = 30;
export const TAMANHO_MAXIMO_DA_DESCRICAO = 200;
export const TAMANHO_MAXIMO_DA_CATEGORIA = 60;
export const TAMANHO_MAXIMO_DA_MARCA = 60;
export const TAMANHO_MAXIMO_DO_TAMANHO_DA_EMBALAGEM = 40;
/** Dígitos de um NCM (coluna `ncm`, CHAR(8)). */
export const DIGITOS_DO_NCM = 8;
/** Um EAN/GTIN tem de 8 a 14 dígitos (coluna `ean`, VARCHAR(14)). */
export const MINIMO_DE_DIGITOS_DO_EAN = 8;
export const MAXIMO_DE_DIGITOS_DO_EAN = 14;
/** Tamanho do termo de busca da lista de produtos. */
export const TAMANHO_MAXIMO_DA_BUSCA = 100;

/** Variações (novas e existentes) aceitas em uma gravação. */
export const MAXIMO_DE_VARIACOES_POR_GRAVACAO = 200;
/**
 * Variações novas aceitas em uma gravação. Cada variação nova e seus preços precisam ser gravados
 * na mesma transação, e o proxy limita a transação a 20 passos (um por variação nova).
 */
export const MAXIMO_DE_VARIACOES_NOVAS_POR_GRAVACAO = 12;
export const MAXIMO_DE_FAIXAS_POR_VARIACAO = 10;
export const MAXIMO_DE_FARDOS_POR_VARIACAO = 10;

const esquemaDeFaixaDePreco = z.object({
  quantidadeMinima: esquemaDeQuantidade,
  precoUnitario: esquemaDeCentavos,
});

const esquemaDeFardo = z.object({
  quantidadeUnidades: esquemaDeQuantidade,
  precoFixo: esquemaDeCentavos,
});

/** Posições, a partir da segunda ocorrência, dos itens cuja chave se repete na lista. */
function posicoesRepetidas<T>(itens: readonly T[], chaveDe: (item: T) => unknown): number[] {
  const vistas = new Set<unknown>();
  return itens.flatMap((item, posicao) => {
    const chave = chaveDe(item);
    if (chave === undefined) {
      return [];
    }
    const repetida = vistas.has(chave);
    vistas.add(chave);
    return repetida ? [posicao] : [];
  });
}

const esquemaDeVariacao = z
  .object({
    /** Presente: altera a variação existente. Ausente: cria uma variação. */
    idVariacao: esquemaDeId.optional(),
    marca: textoObrigatorio(TAMANHO_MAXIMO_DA_MARCA),
    tamanhoEmbalagem: textoObrigatorio(TAMANHO_MAXIMO_DO_TAMANHO_DA_EMBALAGEM),
    /** Só no cadastro da variação; depois o estoque muda por entrada ou ajuste (UC24). */
    quantidadeEstoque: z.number().int().min(0).max(MAIOR_INTEIRO_DO_BANCO).optional(),
    /** Ausente: os preços ficam como estão. Presente: passa a ser a lista completa de faixas. */
    faixasPreco: z.array(esquemaDeFaixaDePreco).max(MAXIMO_DE_FAIXAS_POR_VARIACAO).optional(),
    /** Ausente: os fardos ficam como estão. Presente: passa a ser a lista completa de fardos. */
    fardos: z.array(esquemaDeFardo).max(MAXIMO_DE_FARDOS_POR_VARIACAO).optional(),
  })
  .superRefine((variacao, contexto) => {
    if (variacao.idVariacao !== undefined && variacao.quantidadeEstoque !== undefined) {
      contexto.addIssue({ code: 'custom', path: ['quantidadeEstoque'] });
    }
    for (const posicao of posicoesRepetidas(
      variacao.faixasPreco ?? [],
      (f) => f.quantidadeMinima,
    )) {
      contexto.addIssue({ code: 'custom', path: ['faixasPreco', posicao, 'quantidadeMinima'] });
    }
    for (const posicao of posicoesRepetidas(variacao.fardos ?? [], (f) => f.quantidadeUnidades)) {
      contexto.addIssue({ code: 'custom', path: ['fardos', posicao, 'quantidadeUnidades'] });
    }
  });

/**
 * Corpo de `POST /produtos` e de `PUT /produtos/:id`. No `PUT`, a lista de variações é a lista
 * completa do produto: a variação existente que não vier na lista é removida.
 *
 * Recusa: a mesma variação duas vezes, duas variações com a mesma marca e o mesmo tamanho, a
 * mesma quantidade em duas faixas ou em dois fardos da variação, e estoque informado para uma
 * variação que já existe.
 */
export const esquemaDeProdutoSalvar = z
  .object({
    codigoInterno: textoObrigatorio(TAMANHO_MAXIMO_DO_CODIGO_INTERNO),
    descricao: textoObrigatorio(TAMANHO_MAXIMO_DA_DESCRICAO),
    ncm: digitosOpcionais(DIGITOS_DO_NCM, DIGITOS_DO_NCM),
    ean: digitosOpcionais(MINIMO_DE_DIGITOS_DO_EAN, MAXIMO_DE_DIGITOS_DO_EAN),
    categoria: textoOpcional(TAMANHO_MAXIMO_DA_CATEGORIA),
    ativo: z.boolean(),
    variacoes: z.array(esquemaDeVariacao).max(MAXIMO_DE_VARIACOES_POR_GRAVACAO),
  })
  .superRefine(({ variacoes }, contexto) => {
    for (const posicao of posicoesRepetidas(variacoes, (v) => v.idVariacao)) {
      contexto.addIssue({ code: 'custom', path: ['variacoes', posicao, 'idVariacao'] });
    }
    const marcaETamanho = (v: (typeof variacoes)[number]) =>
      JSON.stringify([v.marca.toLowerCase(), v.tamanhoEmbalagem.toLowerCase()]);
    for (const posicao of posicoesRepetidas(variacoes, marcaETamanho)) {
      contexto.addIssue({ code: 'custom', path: ['variacoes', posicao, 'tamanhoEmbalagem'] });
    }
    const novas = variacoes.filter((v) => v.idVariacao === undefined).length;
    if (novas > MAXIMO_DE_VARIACOES_NOVAS_POR_GRAVACAO) {
      contexto.addIssue({ code: 'custom', path: ['variacoes'] });
    }
  });
export type DadosDoProduto = z.infer<typeof esquemaDeProdutoSalvar>;
export type DadosDaVariacao = DadosDoProduto['variacoes'][number];

/** Consulta de `GET /produtos?q=`: descrição, código interno ou EAN, no todo ou em parte. */
export const esquemaDeListaDeProdutos = z.object({
  q: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DA_BUSCA)
    .optional()
    .transform((termo) => (termo ? termo : undefined)),
});
