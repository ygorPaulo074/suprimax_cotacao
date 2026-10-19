import { AppError } from '../erros';
import type { Esquema } from '../esquema/esquema';
import { aspas, Parametros, validarColuna, type PermissaoLeitura } from './base';

// Filtros declarativos (docs/12, seção 12.8.2):
//   { "e": [ [campo, operador, valor], ... ] }  ou  { "ou": [ ... ] }, aninháveis.
// Operadores: =, !=, >, >=, <, <=, em, contem, nulo, nao_nulo.

export type Escalar = string | number | boolean | null;
export type Condicao = [string, string] | [string, string, Escalar | Escalar[]];
export type Filtro = { e: (Condicao | Filtro)[] } | { ou: (Condicao | Filtro)[] };

const COMPARACAO: Record<string, string> = {
  '=': '=',
  '!=': '<>',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
};

const PROFUNDIDADE_MAXIMA = 5;
const CONDICOES_MAXIMAS = 50;
const ITENS_EM_MAXIMOS = 100;

const invalido = (motivo: string) => new AppError('PAYLOAD_INVALIDO', undefined, motivo);

function escapeLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function ehEscalar(v: unknown): v is Escalar {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

export function filtroVazio(filtros: Filtro | undefined): boolean {
  if (!filtros) return true;
  const itens = 'e' in filtros ? filtros.e : filtros.ou;
  return !Array.isArray(itens) || itens.length === 0;
}

/** Converte o filtro em cláusula WHERE parametrizada (sem a palavra WHERE). */
export function construirWhere(
  filtros: Filtro,
  tabela: string,
  alias: string,
  esquema: Esquema,
  params: Parametros,
  permissao: PermissaoLeitura,
): string {
  let condicoes = 0;

  const condicao = ([campo, operador, valor]: Condicao): string => {
    if (++condicoes > CONDICOES_MAXIMAS) throw invalido('filtro com condições demais');
    const coluna = `${alias}.${aspas(validarColuna(esquema, tabela, campo, permissao))}`;
    if (operador === 'nulo') return `${coluna} IS NULL`;
    if (operador === 'nao_nulo') return `${coluna} IS NOT NULL`;
    if (operador === 'em') {
      if (
        !Array.isArray(valor) ||
        valor.length === 0 ||
        valor.length > ITENS_EM_MAXIMOS ||
        !valor.every(ehEscalar)
      ) {
        throw invalido('"em" exige uma lista de 1 a 100 valores');
      }
      return `${coluna} = ANY(${params.adicionar(valor)})`;
    }
    if (operador === 'contem') {
      if (typeof valor !== 'string') throw invalido('"contem" exige texto');
      return `${coluna} ILIKE ${params.adicionar(`%${escapeLike(valor)}%`)}`;
    }
    const sql = COMPARACAO[operador as string];
    if (!sql) throw invalido(`operador desconhecido: ${String(operador)}`);
    if (!ehEscalar(valor)) throw invalido(`valor inválido para ${operador}`);
    if (valor === null) {
      if (operador === '=') return `${coluna} IS NULL`;
      if (operador === '!=') return `${coluna} IS NOT NULL`;
      throw invalido(`${operador} não aceita nulo`);
    }
    return `${coluna} ${sql} ${params.adicionar(valor)}`;
  };

  const grupo = (f: Filtro, nivel: number): string => {
    if (nivel > PROFUNDIDADE_MAXIMA) throw invalido('filtro aninhado demais');
    const chaves = Object.keys(f);
    if (chaves.length !== 1 || (chaves[0] !== 'e' && chaves[0] !== 'ou')) {
      throw invalido('o filtro deve ter exatamente "e" ou "ou"');
    }
    const itens = 'e' in f ? f.e : f.ou;
    if (!Array.isArray(itens) || itens.length === 0) throw invalido('filtro sem condições');
    const partes = itens.map((item) =>
      Array.isArray(item)
        ? condicao(item as Condicao)
        : typeof item === 'object' && item !== null
          ? grupo(item as Filtro, nivel + 1)
          : (() => {
              throw invalido('condição inválida');
            })(),
    );
    return `(${partes.join('e' in f ? ' AND ' : ' OR ')})`;
  };

  return grupo(filtros, 1);
}
