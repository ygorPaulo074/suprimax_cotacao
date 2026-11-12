// Validação do que chega pela requisição (corpo, parâmetros da rota e da consulta) contra um
// esquema zod. A resposta de erro lista só os campos recusados, nunca os valores.
import type { z } from 'zod';
import { ErroDeValidacao } from '../erros';

const SEPARADOR_DE_CAMINHO = '.';

/**
 * Valida uma entrada da requisição contra o esquema e devolve o valor já normalizado.
 *
 * @param esquema Esquema zod da entrada.
 * @param entrada `req.body`, `req.params` ou `req.query`.
 * @throws {ErroDeValidacao} Com `detalhes.campos` listando os campos recusados (por exemplo,
 * `enderecos.0.cep`), sem os valores.
 */
export function validarEntrada<T>(esquema: z.ZodType<T>, entrada: unknown): T {
  const resultado = esquema.safeParse(entrada);
  if (!resultado.success) {
    const campos = [
      ...new Set(resultado.error.issues.map(({ path }) => path.join(SEPARADOR_DE_CAMINHO))),
    ];
    throw new ErroDeValidacao({ detalhes: { campos: campos.filter((campo) => campo !== '') } });
  }
  return resultado.data;
}
