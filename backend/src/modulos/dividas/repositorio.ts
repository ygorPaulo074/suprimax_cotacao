// UC23 — leitura e gravação da tabela `divida_inadimplencia` (docs/13, seção 13.7.19;
// docs/banco-de-dados/colunas.csv). É o único arquivo do módulo que conhece o proxy e os nomes
// das colunas.
import { z } from 'zod';
import {
  centavosParaDecimal,
  consultar,
  consultarTodas,
  decimalParaCentavos,
  linhasDe,
  validarLinha,
  type ClienteDeProxy,
} from '../../dados';
import { ErroInterno } from '../../erros';

/** Status da dívida (coluna `status`). */
export const STATUS_DA_DIVIDA = ['EM_ABERTO', 'RENEGOCIADA', 'QUITADA', 'PROTESTADA'] as const;
export type StatusDaDivida = (typeof STATUS_DA_DIVIDA)[number];

/**
 * Mínimo exigido na renegociação: 50% do valor da dívida (CHECK do banco, RF25), guardado como
 * divisor inteiro (valor / 2) para não passar por multiplicação decimal em dinheiro.
 */
export const DIVISOR_DO_MINIMO_DA_RENEGOCIACAO = 2;

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_DIVIDAS = {
  LISTAR: 'UC23-listar-dividas',
  BUSCAR: 'UC23-buscar-divida',
  REGISTRAR: 'UC23-registrar-divida',
  RENEGOCIAR: 'UC23-renegociar-divida',
  QUITAR: 'UC23-quitar-divida',
} as const;

const TABELA = 'divida_inadimplencia';
const COLUNAS = [
  'id_divida',
  'id_cliente',
  'id_operador_registro',
  'valor_divida',
  'status',
  'data_vencimento_original',
  'data_renegociacao',
  'valor_pago_renegociacao',
  'data_protesto',
];

/** Dívida registrada. Os valores monetários já vêm convertidos para centavos. */
export interface Divida {
  readonly idDivida: number;
  readonly idCliente: number;
  readonly idOperadorRegistro: number;
  readonly valorDivida: number;
  readonly status: StatusDaDivida;
  readonly dataVencimentoOriginal: string;
  readonly dataRenegociacao: string | null;
  readonly valorPagoRenegociacao: number | null;
  readonly dataProtesto: string | null;
}

/** Dados de uma dívida ainda não gravada (`DividaNova` do frontend). */
export interface DividaAInserir {
  readonly idCliente: number;
  readonly valorDivida: number;
  readonly dataVencimentoOriginal: string;
}

const esquemaDaLinha = z.object({
  idDivida: z.number().int(),
  idCliente: z.number().int(),
  idOperadorRegistro: z.number().int(),
  valorDivida: z.string(),
  status: z.enum(STATUS_DA_DIVIDA),
  dataVencimentoOriginal: z.string(),
  dataRenegociacao: z.string().nullable(),
  valorPagoRenegociacao: z.string().nullable(),
  dataProtesto: z.string().nullable(),
});

function paraDivida(linha: unknown): Divida {
  const validada = validarLinha(esquemaDaLinha, linha, TABELA);
  return {
    ...validada,
    valorDivida: decimalParaCentavos(validada.valorDivida),
    valorPagoRenegociacao:
      validada.valorPagoRenegociacao === null
        ? null
        : decimalParaCentavos(validada.valorPagoRenegociacao),
  };
}

/** Acesso às dívidas de inadimplência, sempre pelo proxy. */
export class RepositorioDeDividas {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Todas as dívidas, mais recentes primeiro. */
  async listar(): Promise<Divida[]> {
    const linhas = await consultarTodas(
      this.proxy,
      { tabela: TABELA, campos: COLUNAS, ordenacao: [['id_divida', 'desc']] },
      OPERACOES_DE_DIVIDAS.LISTAR,
    );
    return linhas.map(paraDivida);
  }

  /** Busca a dívida pelo identificador; `null` se não existir. */
  async buscarPorId(idDivida: number): Promise<Divida | null> {
    const [linha] = await consultar(
      this.proxy,
      { tabela: TABELA, campos: COLUNAS, filtros: { e: [['id_divida', '=', idDivida]] } },
      OPERACOES_DE_DIVIDAS.BUSCAR,
    );
    return linha === undefined ? null : paraDivida(linha);
  }

  /** Grava a dívida (status inicial EM_ABERTO) e devolve a linha criada. */
  async inserir(dados: DividaAInserir, idOperadorRegistro: number): Promise<Divida> {
    const resposta = await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA,
        valores: {
          id_cliente: dados.idCliente,
          id_operador_registro: idOperadorRegistro,
          valor_divida: centavosParaDecimal(dados.valorDivida),
          data_vencimento_original: dados.dataVencimentoOriginal,
        },
        retornar: COLUNAS,
      },
      OPERACOES_DE_DIVIDAS.REGISTRAR,
    );
    const [linha] = linhasDe(resposta);
    if (linha === undefined) {
      throw new ErroInterno(new Error('O registro da dívida não devolveu a linha gravada.'));
    }
    return paraDivida(linha);
  }

  /** Marca a dívida como RENEGOCIADA, com a data e o valor pago. */
  async renegociar(
    idDivida: number,
    dados: { dataRenegociacao: string; valorPagoRenegociacao: number },
  ): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA,
        filtros: { e: [['id_divida', '=', idDivida]] },
        valores: {
          status: 'RENEGOCIADA' satisfies StatusDaDivida,
          data_renegociacao: dados.dataRenegociacao,
          valor_pago_renegociacao: centavosParaDecimal(dados.valorPagoRenegociacao),
        },
      },
      OPERACOES_DE_DIVIDAS.RENEGOCIAR,
    );
  }

  /** Marca a dívida como QUITADA (UC23, passo 5). */
  async quitar(idDivida: number): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA,
        filtros: { e: [['id_divida', '=', idDivida]] },
        valores: { status: 'QUITADA' satisfies StatusDaDivida },
      },
      OPERACOES_DE_DIVIDAS.QUITAR,
    );
  }
}
