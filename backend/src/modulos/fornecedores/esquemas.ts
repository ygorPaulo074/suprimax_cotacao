// UC22 — formato do corpo das rotas de fornecedores. Tamanhos: docs/13, seção 13.7.17.
import { z } from 'zod';
import {
  esquemaDeCnpj,
  esquemaDeEmailOpcional,
  TAMANHO_MAXIMO_DA_RAZAO_SOCIAL,
  TAMANHO_MAXIMO_DO_NOME_DE_CONTATO,
  TAMANHO_MAXIMO_DO_TELEFONE,
  textoObrigatorio,
  textoOpcional,
} from '../comum/campos';

/** Corpo de `POST /fornecedores`: o cadastro mínimo do RF22. */
export const esquemaDeFornecedorNovo = z.object({
  cnpj: esquemaDeCnpj,
  razaoSocial: textoObrigatorio(TAMANHO_MAXIMO_DA_RAZAO_SOCIAL),
  nomeContato: textoOpcional(TAMANHO_MAXIMO_DO_NOME_DE_CONTATO),
  telefoneContato: textoOpcional(TAMANHO_MAXIMO_DO_TELEFONE),
  emailContato: esquemaDeEmailOpcional,
});
export type DadosDoFornecedorNovo = z.infer<typeof esquemaDeFornecedorNovo>;
