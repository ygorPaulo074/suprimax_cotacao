// UC04 (passos 6-8) — gravação da tabela `entrada_mercadoria` (docs/banco-de-dados/colunas.csv;
// RF19). É o único arquivo do módulo que conhece o proxy e os nomes das colunas.
import { linhasDe, type ClienteDeProxy } from '../../dados';
import { ErroInterno } from '../../erros';

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_ENTRADAS = {
  REGISTRAR: 'UC04-registrar-entrada-mercadoria',
} as const;

const TABELA = 'entrada_mercadoria';

/** Dados de uma entrada de mercadoria ainda não gravada. */
export interface EntradaAInserir {
  readonly idVariacao: number;
  readonly idFornecedor: number;
  readonly idOperador: number;
  readonly numeroCotacaoCompra: string | null;
  readonly quantidadeComprada: number;
  readonly quantidadeInformada: number;
  /** Preenchidos só quando houve divergência liberada por um operador chefe (RF19). */
  readonly idOperadorLiberacao: number | null;
  readonly dataLiberacao: Date | null;
}

/** Acesso às entradas de mercadoria, sempre pelo proxy. */
export class RepositorioDeEntradas {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Grava a entrada e devolve o identificador gerado. */
  async inserir(dados: EntradaAInserir): Promise<number> {
    const resposta = await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA,
        valores: {
          id_variacao: dados.idVariacao,
          id_fornecedor: dados.idFornecedor,
          id_operador: dados.idOperador,
          numero_cotacao_compra: dados.numeroCotacaoCompra,
          quantidade_comprada: dados.quantidadeComprada,
          quantidade_informada: dados.quantidadeInformada,
          id_operador_liberacao: dados.idOperadorLiberacao,
          data_liberacao: dados.dataLiberacao?.toISOString() ?? null,
        },
        retornar: ['id_entrada'],
      },
      OPERACOES_DE_ENTRADAS.REGISTRAR,
    );
    const [linha] = linhasDe(resposta) as { idEntrada?: number }[];
    if (linha?.idEntrada === undefined) {
      throw new ErroInterno(
        new Error('O registro da entrada de mercadoria não devolveu o identificador.'),
      );
    }
    return linha.idEntrada;
  }
}
