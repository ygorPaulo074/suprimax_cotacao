// UC02 e UC03 — formato do corpo e dos parâmetros das rotas de clientes. Tamanhos: docs/13,
// seções 13.7.2 e 13.7.3.
import { z } from 'zod';
import {
  esquemaDeCep,
  esquemaDeCnpj,
  esquemaDeEmailOpcional,
  TAMANHO_MAXIMO_DA_RAZAO_SOCIAL,
  TAMANHO_MAXIMO_DO_NOME_DE_CONTATO,
  TAMANHO_MAXIMO_DO_TELEFONE,
  esquemaDeId,
  textoObrigatorio,
  textoOpcional,
} from '../comum/campos';
import { TIPOS_DE_ENDERECO, TIPOS_DE_UNIDADE } from './repositorio';

/** Siglas das 27 unidades da federação. */
export const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;

export const TAMANHO_MAXIMO_DO_LOGRADOURO = 150;
export const TAMANHO_MAXIMO_DO_NUMERO = 10;
export const TAMANHO_MAXIMO_DO_COMPLEMENTO = 60;
export const TAMANHO_MAXIMO_DO_BAIRRO = 80;
export const TAMANHO_MAXIMO_DA_CIDADE = 80;
/** Endereços aceitos em um cadastro (o cadastral e os locais de entrega). */
export const MAXIMO_DE_ENDERECOS_POR_CLIENTE = 50;

const esquemaDeEndereco = z.object({
  tipo: z.enum(TIPOS_DE_ENDERECO),
  logradouro: textoObrigatorio(TAMANHO_MAXIMO_DO_LOGRADOURO),
  numero: textoObrigatorio(TAMANHO_MAXIMO_DO_NUMERO),
  complemento: textoOpcional(TAMANHO_MAXIMO_DO_COMPLEMENTO),
  bairro: textoObrigatorio(TAMANHO_MAXIMO_DO_BAIRRO),
  cidade: textoObrigatorio(TAMANHO_MAXIMO_DA_CIDADE),
  uf: z.string().trim().toUpperCase().pipe(z.enum(UFS)),
  cep: esquemaDeCep,
});

/**
 * Corpo de `POST /clientes`. O cadastro só é aceito com `aceiteLgpd: true`: sem a confirmação
 * da cláusula de consentimento, o salvamento é bloqueado (RF20, UC02-E1).
 */
export const esquemaDeClienteNovo = z.object({
  cnpj: esquemaDeCnpj,
  razaoSocial: textoObrigatorio(TAMANHO_MAXIMO_DA_RAZAO_SOCIAL),
  nomeContato: textoObrigatorio(TAMANHO_MAXIMO_DO_NOME_DE_CONTATO),
  telefoneContato: textoOpcional(TAMANHO_MAXIMO_DO_TELEFONE),
  emailContato: esquemaDeEmailOpcional,
  tipoUnidade: z.enum(TIPOS_DE_UNIDADE),
  idOperadorVendedor: esquemaDeId,
  enderecos: z.array(esquemaDeEndereco).min(1).max(MAXIMO_DE_ENDERECOS_POR_CLIENTE),
  aceiteLgpd: z.literal(true),
});
export type DadosDoClienteNovo = z.infer<typeof esquemaDeClienteNovo>;

/** Consulta de `GET /clientes/busca?cnpj=`. */
export const esquemaDeBuscaPorCnpj = z.object({ cnpj: esquemaDeCnpj });
