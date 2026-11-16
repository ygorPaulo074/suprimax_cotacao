// UC02 e UC03 — leitura e gravação das tabelas `cliente` e `endereco_cliente`, e leitura da
// dívida em aberto (docs/13, seções 13.7.2, 13.7.3 e 13.7.14). É o único arquivo do módulo que
// conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  consultar,
  decimalParaCentavos,
  executarLote,
  linhasDoPasso,
  referenciaAoPasso,
  validarLinha,
  type ClienteDeProxy,
} from '../../dados';
import { ErroInterno } from '../../erros';

/** Tipos de unidade (coluna `cliente.tipo_unidade`). */
export const TIPOS_DE_UNIDADE = ['MATRIZ', 'FILIAL'] as const;
export type TipoDeUnidade = (typeof TIPOS_DE_UNIDADE)[number];

/** Situações do cliente (coluna `cliente.status`). */
export const STATUS_DO_CLIENTE = ['ATIVO', 'INATIVO', 'BLOQUEADO'] as const;
export type StatusDoCliente = (typeof STATUS_DO_CLIENTE)[number];

/** Tipos de endereço (coluna `endereco_cliente.tipo`). */
export const TIPOS_DE_ENDERECO = ['CADASTRAL', 'ENTREGA'] as const;
export type TipoDeEndereco = (typeof TIPOS_DE_ENDERECO)[number];

/**
 * Dívidas que bloqueiam novos orçamentos: em aberto ou protestadas, isto é, ainda não renegociadas
 * nem quitadas (RN06; docs/13, seção 13.4, "Cliente inadimplente").
 */
export const STATUS_DE_DIVIDA_QUE_BLOQUEIAM = ['EM_ABERTO', 'PROTESTADA'] as const;

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_CLIENTES = {
  BUSCAR: 'UC03-buscar-cliente',
  SOMAR_DIVIDA: 'UC03-somar-divida',
  CADASTRAR: 'UC02-cadastrar-cliente',
} as const;

const TABELA_DE_CLIENTES = 'cliente';
const TABELA_DE_ENDERECOS = 'endereco_cliente';
const TABELA_DE_DIVIDAS = 'divida_inadimplencia';
const COLUNAS_DO_CLIENTE = [
  'id_cliente',
  'cnpj',
  'razao_social',
  'nome_contato',
  'telefone_contato',
  'email_contato',
  'tipo_unidade',
  'status',
  'id_operador_vendedor',
];
const PASSO_DO_CLIENTE = 'cliente';
const PASSO_DOS_ENDERECOS = 'enderecos';
const ALIAS_DO_TOTAL = 'total';

/** Endereço ainda não gravado. */
export interface EnderecoAInserir {
  readonly tipo: TipoDeEndereco;
  readonly logradouro: string;
  readonly numero: string;
  readonly complemento: string | null;
  readonly bairro: string;
  readonly cidade: string;
  readonly uf: string;
  /** Só os 8 dígitos. */
  readonly cep: string;
}

/** Endereço cadastral ou de entrega de um cliente. */
export interface EnderecoDoCliente extends EnderecoAInserir {
  readonly idEndereco: number;
}

/** Dados cadastrais de um cliente ainda não gravado. */
export interface ClienteAInserir {
  /** Só os 14 dígitos. */
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly nomeContato: string;
  readonly telefoneContato: string | null;
  readonly emailContato: string | null;
  readonly tipoUnidade: TipoDeUnidade;
  readonly idOperadorVendedor: number;
  readonly enderecos: readonly EnderecoAInserir[];
}

/** Cliente cadastrado, com seus endereços. */
export interface ClienteCadastrado extends Omit<ClienteAInserir, 'enderecos'> {
  readonly idCliente: number;
  readonly status: StatusDoCliente;
  readonly enderecos: readonly EnderecoDoCliente[];
}

const esquemaDoEndereco = z.object({
  idEndereco: z.number().int(),
  tipo: z.enum(TIPOS_DE_ENDERECO),
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string().nullable(),
  bairro: z.string(),
  cidade: z.string(),
  uf: z.string(),
  cep: z.string(),
});

const esquemaDoCliente = z.object({
  idCliente: z.number().int(),
  cnpj: z.string(),
  razaoSocial: z.string(),
  nomeContato: z.string(),
  telefoneContato: z.string().nullable(),
  emailContato: z.string().nullable(),
  tipoUnidade: z.enum(TIPOS_DE_UNIDADE),
  status: z.enum(STATUS_DO_CLIENTE),
  idOperadorVendedor: z.number().int(),
  // Com `incluir`, o proxy devolve as linhas filhas em uma lista com o nome da tabela.
  enderecoCliente: z.array(esquemaDoEndereco),
});

const esquemaDoTotalDaDivida = z.object({ total: z.string().nullable() });
const esquemaDoIdDoCliente = z.object({ idCliente: z.number().int() });

/** Acesso aos clientes, sempre pelo proxy. */
export class RepositorioDeClientes {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Busca o cliente pelo CNPJ (14 dígitos), com os endereços; `null` se não existir. */
  async buscarPorCnpj(cnpj: string): Promise<ClienteCadastrado | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_CLIENTES,
        campos: COLUNAS_DO_CLIENTE,
        filtros: { e: [['cnpj', '=', cnpj]] },
        incluir: [TABELA_DE_ENDERECOS],
        limite: 1,
      },
      OPERACOES_DE_CLIENTES.BUSCAR,
    );
    if (linha === undefined) {
      return null;
    }
    const { enderecoCliente, ...cliente } = validarLinha(
      esquemaDoCliente,
      linha,
      TABELA_DE_CLIENTES,
    );
    const enderecos = [...enderecoCliente].sort((a, b) => a.idEndereco - b.idEndereco);
    return { ...cliente, enderecos };
  }

  /** Busca o cliente pelo identificador, com os endereços; `null` se não existir. */
  async buscarPorId(idCliente: number): Promise<ClienteCadastrado | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_CLIENTES,
        campos: COLUNAS_DO_CLIENTE,
        filtros: { e: [['id_cliente', '=', idCliente]] },
        incluir: [TABELA_DE_ENDERECOS],
        limite: 1,
      },
      OPERACOES_DE_CLIENTES.BUSCAR,
    );
    if (linha === undefined) {
      return null;
    }
    const { enderecoCliente, ...cliente } = validarLinha(
      esquemaDoCliente,
      linha,
      TABELA_DE_CLIENTES,
    );
    const enderecos = [...enderecoCliente].sort((a, b) => a.idEndereco - b.idEndereco);
    return { ...cliente, enderecos };
  }

  /**
   * Grava o cliente e seus endereços em uma única transação, com o aceite da cláusula LGPD.
   *
   * @param aceiteLgpdEm Momento em que o operador confirmou o consentimento (RF20).
   * @returns O identificador do cliente criado.
   */
  async inserir(cliente: ClienteAInserir, aceiteLgpdEm: Date): Promise<number> {
    const resultados = await executarLote(
      this.proxy,
      [
        {
          id: PASSO_DO_CLIENTE,
          operacao: 'dados.inserir',
          payload: {
            tabela: TABELA_DE_CLIENTES,
            valores: {
              cnpj: cliente.cnpj,
              razao_social: cliente.razaoSocial,
              nome_contato: cliente.nomeContato,
              telefone_contato: cliente.telefoneContato,
              email_contato: cliente.emailContato,
              tipo_unidade: cliente.tipoUnidade,
              id_operador_vendedor: cliente.idOperadorVendedor,
              aceite_lgpd: true,
              data_aceite_lgpd: aceiteLgpdEm.toISOString(),
            },
            retornar: ['id_cliente'],
          },
        },
        {
          id: PASSO_DOS_ENDERECOS,
          operacao: 'dados.inserir',
          payload: {
            tabela: TABELA_DE_ENDERECOS,
            valores: cliente.enderecos.map((endereco) => ({
              id_cliente: referenciaAoPasso(PASSO_DO_CLIENTE, 0, 'id_cliente'),
              tipo: endereco.tipo,
              logradouro: endereco.logradouro,
              numero: endereco.numero,
              complemento: endereco.complemento,
              bairro: endereco.bairro,
              cidade: endereco.cidade,
              uf: endereco.uf,
              cep: endereco.cep,
            })),
            retornar: ['id_endereco'],
          },
        },
      ],
      OPERACOES_DE_CLIENTES.CADASTRAR,
    );
    const [linha] = linhasDoPasso(resultados, PASSO_DO_CLIENTE);
    if (linha === undefined) {
      throw new ErroInterno(new Error('O cadastro do cliente não devolveu o identificador.'));
    }
    return validarLinha(esquemaDoIdDoCliente, linha, TABELA_DE_CLIENTES).idCliente;
  }

  /** Soma, em centavos, as dívidas do cliente que bloqueiam novos orçamentos. */
  async somarDividaEmAberto(idCliente: number): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_DIVIDAS,
        filtros: {
          e: [
            ['id_cliente', '=', idCliente],
            ['status', 'em', [...STATUS_DE_DIVIDA_QUE_BLOQUEIAM]],
          ],
        },
        agregacoes: [{ fn: 'soma', campo: 'valor_divida', como: ALIAS_DO_TOTAL }],
      },
      OPERACOES_DE_CLIENTES.SOMAR_DIVIDA,
    );
    const { total } = validarLinha(esquemaDoTotalDaDivida, linha, TABELA_DE_DIVIDAS);
    return total === null ? 0 : decimalParaCentavos(total);
  }
}
