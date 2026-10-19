import { AppError } from '../erros';
import { COLUNAS_SENSIVEIS, type Esquema } from '../esquema/esquema';

// Peças comuns dos geradores de SQL. Nenhum valor entra no texto da consulta: vai como
// parâmetro ($1, $2, …). Nomes de tabelas e colunas só entram depois de validados contra o
// esquema e sempre entre aspas duplas.

export class Parametros {
  readonly valores: unknown[] = [];
  adicionar(valor: unknown): string {
    this.valores.push(valor);
    return `$${this.valores.length}`;
  }
}

export const aspas = (nome: string): string => `"${nome}"`;

/** O que a requisição pode ver: define se as colunas sensíveis podem ser lidas. */
export interface PermissaoLeitura {
  credenciais: boolean;
}

export const SEM_CREDENCIAIS: PermissaoLeitura = { credenciais: false };

export function validarTabela(esquema: Esquema, tabela: unknown): string {
  if (typeof tabela !== 'string' || !esquema.tabelaExiste(tabela)) {
    throw new AppError('PAYLOAD_INVALIDO', undefined, `tabela inexistente: ${String(tabela)}`);
  }
  return tabela;
}

export function ehSensivel(tabela: string, coluna: string): boolean {
  return COLUNAS_SENSIVEIS[tabela]?.includes(coluna) ?? false;
}

/** Valida a coluna e bloqueia as sensíveis sem permissão (ESCOPO_NEGADO). */
export function validarColuna(
  esquema: Esquema,
  tabela: string,
  coluna: unknown,
  permissao: PermissaoLeitura,
): string {
  if (typeof coluna !== 'string' || !esquema.temColuna(tabela, coluna)) {
    throw new AppError(
      'PAYLOAD_INVALIDO',
      undefined,
      `coluna inexistente: ${tabela}.${String(coluna)}`,
    );
  }
  if (ehSensivel(tabela, coluna) && !permissao.credenciais) {
    throw new AppError('ESCOPO_NEGADO', undefined, `coluna sensível: ${tabela}.${coluna}`);
  }
  return coluna;
}

/** Colunas devolvidas por padrão: todas, menos as sensíveis quando não há permissão. */
export function colunasVisiveis(
  esquema: Esquema,
  tabela: string,
  permissao: PermissaoLeitura,
): string[] {
  return esquema.colunas(tabela).filter((c) => permissao.credenciais || !ehSensivel(tabela, c));
}

export const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

export function validarIdentificador(valor: unknown, nome: string): string {
  if (typeof valor !== 'string' || !IDENTIFICADOR.test(valor) || valor.length > 63) {
    throw new AppError('PAYLOAD_INVALIDO', undefined, `${nome} inválido`);
  }
  return valor;
}
