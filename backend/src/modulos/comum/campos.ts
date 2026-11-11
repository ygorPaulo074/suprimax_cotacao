// Item 5 do backend/TAREFAS.md — esquemas zod dos campos que se repetem nos cadastros. Os
// tamanhos vêm do dicionário de dados (docs/13, seção 13.7).
import { z } from 'zod';

/** Dígitos de um CNPJ (colunas `cnpj`, CHAR(14)). */
export const TAMANHO_DO_CNPJ = 14;
/** Dígitos de um CEP (coluna `cep`, CHAR(8)). */
export const TAMANHO_DO_CEP = 8;
/** Tamanho das colunas `razao_social`. */
export const TAMANHO_MAXIMO_DA_RAZAO_SOCIAL = 150;
/** Tamanho das colunas `nome_contato`. */
export const TAMANHO_MAXIMO_DO_NOME_DE_CONTATO = 100;
/** Tamanho das colunas `telefone_contato`. */
export const TAMANHO_MAXIMO_DO_TELEFONE = 20;
/** Tamanho das colunas de e-mail. */
export const TAMANHO_MAXIMO_DO_EMAIL = 120;
/** Maior valor de uma coluna INTEGER do banco. */
export const MAIOR_INTEIRO_DO_BANCO = 2_147_483_647;
/** Maior valor, em centavos, que cabe em um DECIMAL(12,2). */
export const MAIOR_VALOR_EM_CENTAVOS = 999_999_999_999;

/** Pontuação da máscara de CNPJ e de CEP (`12.345.678/0001-90`, `74000-000`). */
const PADRAO_DA_MASCARA = /[.\-/\s]/g;
const PADRAO_DO_CNPJ = new RegExp(`^\\d{${TAMANHO_DO_CNPJ}}$`);
const PADRAO_DO_CEP = new RegExp(`^\\d{${TAMANHO_DO_CEP}}$`);
const PADRAO_DE_ID_NA_ROTA = /^[1-9]\d{0,9}$/;

function semMascara(texto: string): string {
  return texto.replace(PADRAO_DA_MASCARA, '');
}

/**
 * CNPJ com ou sem máscara; o resultado tem só os 14 dígitos. Confere apenas o formato: o dígito
 * verificador não é validado (decisão do briefing do item 5).
 */
export const esquemaDeCnpj = z
  .string()
  .transform(semMascara)
  .pipe(z.string().regex(PADRAO_DO_CNPJ));

/** CEP com ou sem hífen; o resultado tem só os 8 dígitos. */
export const esquemaDeCep = z.string().transform(semMascara).pipe(z.string().regex(PADRAO_DO_CEP));

/**
 * Código numérico opcional, com ou sem pontuação (NCM `4802.56.10`, EAN). O resultado tem só os
 * dígitos; ausente, nulo ou em branco viram `null`.
 *
 * @param minimo Menor quantidade de dígitos aceita.
 * @param maximo Maior quantidade de dígitos aceita.
 */
export function digitosOpcionais(minimo: number, maximo: number) {
  const padrao = new RegExp(`^\\d{${minimo},${maximo}}$`);
  return z
    .string()
    .nullish()
    .transform((texto) => semMascara(texto ?? ''))
    .pipe(z.union([z.literal(''), z.string().regex(padrao)]))
    .transform((digitos) => (digitos === '' ? null : digitos));
}

/** Texto obrigatório: sem espaços nas pontas, com pelo menos um caractere e até `maximo`. */
export function textoObrigatorio(maximo: number) {
  return z.string().trim().min(1).max(maximo);
}

/**
 * Texto opcional, para coluna que aceita nulo. Ausente, nulo ou em branco viram `null`, que é o
 * que vai para o banco.
 */
export function textoOpcional(maximo: number) {
  return z
    .string()
    .trim()
    .max(maximo)
    .nullish()
    .transform((texto) => (texto ? texto : null));
}

/** E-mail obrigatório, sem espaços nas pontas. */
export const esquemaDeEmail = z.string().trim().max(TAMANHO_MAXIMO_DO_EMAIL).pipe(z.email());

/** E-mail opcional: ausente, nulo ou em branco viram `null`. */
export const esquemaDeEmailOpcional = z
  .union([z.literal(''), esquemaDeEmail])
  .nullish()
  .transform((email) => (email ? email : null));

/** Identificador (chave primária) recebido no corpo JSON. */
export const esquemaDeId = z.number().int().positive().max(MAIOR_INTEIRO_DO_BANCO);

/** Identificador recebido como texto na rota (`/produtos/:id`). */
export const esquemaDeIdNaRota = z
  .string()
  .regex(PADRAO_DE_ID_NA_ROTA)
  .transform(Number)
  .pipe(esquemaDeId);

/** Parâmetros de uma rota com `:id`. */
export const esquemaDeParametroId = z.object({ id: esquemaDeIdNaRota });

/** Valor em dinheiro: centavos inteiros, de zero ao maior DECIMAL(12,2). */
export const esquemaDeCentavos = z.number().int().min(0).max(MAIOR_VALOR_EM_CENTAVOS);

/** Quantidade inteira maior que zero. */
export const esquemaDeQuantidade = z.number().int().positive().max(MAIOR_INTEIRO_DO_BANCO);
