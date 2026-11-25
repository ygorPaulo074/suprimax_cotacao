import { ApiError } from '@/api/errors';

/** Campos que o backend recusou, lidos de `detalhes.campos` da resposta de erro. */
export interface CamposRecusados {
  /** Código do erro (`VALIDATION_ERROR`, `PRODUTO_JA_CADASTRADO`...). */
  readonly codigo: string;
  /** Caminhos como o backend os envia, por exemplo `ncm` ou `variacoes.0.quantidadeEstoque`. */
  readonly caminhos: ReadonlySet<string>;
}

/**
 * Lê quais campos o backend recusou. O backend lista só os caminhos, nunca os valores (docs/frontend-api.md).
 *
 * @returns `null` se o erro não for da API ou não trouxer a lista de campos.
 */
export function camposRecusados(erro: unknown): CamposRecusados | null {
  if (!(erro instanceof ApiError)) return null;
  const campos = erro.detalhes?.campos;
  if (!Array.isArray(campos)) return null;
  const caminhos = campos.filter((c): c is string => typeof c === 'string' && c !== '');
  return caminhos.length > 0 ? { codigo: erro.codigo, caminhos: new Set(caminhos) } : null;
}

/** Devolve a lista sem o caminho informado (o campo foi editado, então deixa de aparecer como inválido). */
export function semCaminho(
  recusa: CamposRecusados | null,
  caminho: string,
): CamposRecusados | null {
  if (!recusa?.caminhos.has(caminho)) return recusa;
  return { ...recusa, caminhos: new Set([...recusa.caminhos].filter((c) => c !== caminho)) };
}
