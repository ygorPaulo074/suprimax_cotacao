// UC22 — leitura e gravação da tabela `fornecedor` (docs/13, seção 13.7.17). É o único arquivo do
// módulo que conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  consultar,
  consultarTodas,
  linhasDe,
  validarLinha,
  type ClienteDeProxy,
} from '../../dados';
import { ErroInterno } from '../../erros';

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_FORNECEDORES = {
  LISTAR: 'UC22-listar-fornecedores',
  BUSCAR: 'UC22-buscar-fornecedor',
  CADASTRAR: 'UC22-cadastrar-fornecedor',
} as const;

const TABELA = 'fornecedor';
const COLUNAS = [
  'id_fornecedor',
  'cnpj',
  'razao_social',
  'nome_contato',
  'telefone_contato',
  'email_contato',
];

/** Fornecedor cadastrado. É o tipo `Fornecedor` de `frontend/src/api/types.ts`. */
export interface Fornecedor {
  readonly idFornecedor: number;
  /** Só os 14 dígitos. */
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly nomeContato: string | null;
  readonly telefoneContato: string | null;
  readonly emailContato: string | null;
}

/** Dados de um fornecedor ainda não gravado. */
export type FornecedorAInserir = Omit<Fornecedor, 'idFornecedor'>;

const esquemaDoFornecedor = z.object({
  idFornecedor: z.number().int(),
  cnpj: z.string(),
  razaoSocial: z.string(),
  nomeContato: z.string().nullable(),
  telefoneContato: z.string().nullable(),
  emailContato: z.string().nullable(),
});

function paraFornecedor(linha: unknown): Fornecedor {
  return validarLinha(esquemaDoFornecedor, linha, TABELA);
}

/** Acesso aos fornecedores, sempre pelo proxy. */
export class RepositorioDeFornecedores {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Todos os fornecedores, em ordem alfabética da razão social. */
  async listar(): Promise<Fornecedor[]> {
    const linhas = await consultarTodas(
      this.proxy,
      { tabela: TABELA, campos: COLUNAS, ordenacao: [['razao_social', 'asc']] },
      OPERACOES_DE_FORNECEDORES.LISTAR,
    );
    return linhas.map(paraFornecedor);
  }

  /** Busca o fornecedor pelo CNPJ (14 dígitos); `null` se não existir. */
  async buscarPorCnpj(cnpj: string): Promise<Fornecedor | null> {
    const [linha] = await consultar(
      this.proxy,
      { tabela: TABELA, campos: COLUNAS, filtros: { e: [['cnpj', '=', cnpj]] }, limite: 1 },
      OPERACOES_DE_FORNECEDORES.BUSCAR,
    );
    return linha === undefined ? null : paraFornecedor(linha);
  }

  /** Grava o fornecedor e devolve a linha criada. */
  async inserir(novo: FornecedorAInserir): Promise<Fornecedor> {
    const resposta = await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA,
        valores: {
          cnpj: novo.cnpj,
          razao_social: novo.razaoSocial,
          nome_contato: novo.nomeContato,
          telefone_contato: novo.telefoneContato,
          email_contato: novo.emailContato,
        },
        retornar: COLUNAS,
      },
      OPERACOES_DE_FORNECEDORES.CADASTRAR,
    );
    const [linha] = linhasDe(resposta);
    if (linha === undefined) {
      throw new ErroInterno(new Error('O cadastro do fornecedor não devolveu a linha gravada.'));
    }
    return paraFornecedor(linha);
  }
}
