// Item 2 do backend/TAREFAS.md — conversão de formatos entre o banco e o backend.
// Só a camada de acesso a dados converte: DECIMAL em texto ↔ centavos inteiros e
// snake_case ↔ camelCase (comunicacao-backend-proxy.md, seção 5).

/** Quantos centavos tem uma unidade monetária. */
export const CENTAVOS_POR_UNIDADE = 100;

/** Casas decimais de um DECIMAL(12,2). */
export const CASAS_DECIMAIS = 2;

const PADRAO_DECIMAL = new RegExp(`^(-?)(\\d+)(?:\\.(\\d{1,${CASAS_DECIMAIS}}))?$`);
const PADRAO_SUBLINHADO_E_CARACTERE = /_+([a-z0-9])/g;
const PADRAO_LETRA_MAIUSCULA = /[A-Z]/g;
const SEPARADOR_DECIMAL = '.';
const SEPARADOR_SNAKE_CASE = '_';

/**
 * Valor que não pode ser convertido sem perda. A conversão nunca arredonda nem corrige o valor em
 * silêncio: dinheiro errado é pior do que um erro visível.
 */
export class ConversaoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConversaoError';
  }
}

/**
 * Converte um DECIMAL(12,2) recebido do proxy como texto em centavos inteiros, sem passar por
 * ponto flutuante.
 *
 * @example decimalParaCentavos('12.34') // 1234
 * @example decimalParaCentavos('5') // 500
 * @example decimalParaCentavos('0.5') // 50
 * @throws {ConversaoError} Se o texto não for um decimal com até duas casas.
 */
export function decimalParaCentavos(texto: string): number {
  const partes = PADRAO_DECIMAL.exec(texto);
  if (!partes) {
    throw new ConversaoError('O valor não é um decimal com até duas casas.');
  }
  const [, sinal, inteiro = '0', fracao = ''] = partes;
  const centavos =
    Number(inteiro) * CENTAVOS_POR_UNIDADE + Number(fracao.padEnd(CASAS_DECIMAIS, '0'));
  if (!Number.isSafeInteger(centavos)) {
    throw new ConversaoError('O valor é grande demais para ser representado em centavos.');
  }
  return sinal && centavos !== 0 ? -centavos : centavos;
}

/**
 * Converte centavos inteiros no texto decimal que o proxy espera ao gravar um DECIMAL(12,2).
 *
 * @example centavosParaDecimal(1234) // '12.34'
 * @throws {ConversaoError} Se o valor não for um inteiro.
 */
export function centavosParaDecimal(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new ConversaoError('O valor em centavos deve ser um número inteiro.');
  }
  const absoluto = Math.abs(centavos);
  const inteiro = Math.trunc(absoluto / CENTAVOS_POR_UNIDADE);
  const fracao = String(absoluto % CENTAVOS_POR_UNIDADE).padStart(CASAS_DECIMAIS, '0');
  return `${centavos < 0 ? '-' : ''}${inteiro}${SEPARADOR_DECIMAL}${fracao}`;
}

/** Converte o nome de uma coluna para camelCase: `preco_unitario_aplicado` → `precoUnitarioAplicado`. */
export function paraCamelCase(chave: string): string {
  return chave.replace(PADRAO_SUBLINHADO_E_CARACTERE, (_trecho, caractere: string) =>
    caractere.toUpperCase(),
  );
}

/** Converte o nome de um campo para snake_case: `precoUnitarioAplicado` → `preco_unitario_aplicado`. */
export function paraSnakeCase(chave: string): string {
  return chave.replace(
    PADRAO_LETRA_MAIUSCULA,
    (letra) => `${SEPARADOR_SNAKE_CASE}${letra.toLowerCase()}`,
  );
}

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const prototipo: unknown = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function converterChaves(valor: unknown, converter: (chave: string) => string): unknown {
  if (Array.isArray(valor)) {
    return valor.map((item: unknown) => converterChaves(item, converter));
  }
  if (!ehObjetoSimples(valor)) {
    return valor;
  }
  return Object.fromEntries(
    Object.entries(valor).map(([chave, item]) => [
      converter(chave),
      converterChaves(item, converter),
    ]),
  );
}

/**
 * Devolve uma cópia com todas as chaves em camelCase, em qualquer nível de objetos e listas.
 * Os valores não mudam; `Date`, `null` e instâncias de classes passam como estão.
 */
export function converterChavesParaCamelCase(valor: unknown): unknown {
  return converterChaves(valor, paraCamelCase);
}

/**
 * Devolve uma cópia com todas as chaves em snake_case, em qualquer nível de objetos e listas.
 * Use nos `valores` de `dados.inserir` e `dados.atualizar`.
 */
export function converterChavesParaSnakeCase(valor: unknown): unknown {
  return converterChaves(valor, paraSnakeCase);
}
