// UC07 — leitura e gravação de `analise_credito` e `documento_analise_credito` (docs/13, seção
// 13.7.20/21; docs/banco-de-dados/colunas.csv). É o único arquivo do módulo que conhece o proxy
// e os nomes das colunas.
import { z } from 'zod';
import {
  consultar,
  consultarTodas,
  decimalParaCentavos,
  linhasDe,
  validarLinha,
  type ClienteDeProxy,
} from '../../dados';
import { ErroInterno } from '../../erros';
import { RESULTADOS_DE_CREDITO, type ResultadoDeCredito } from '../comum/situacaoCliente';

/** Tipos de documento do checklist de crédito (coluna `documento_analise_credito.tipo_documento`). */
export const TIPOS_DE_DOCUMENTO_CREDITO = [
  'CONTRATO_SOCIAL',
  'BALANCO_LUCRO',
  'COMPROVANTE_ENDERECO',
  'DOCUMENTO_PROPRIETARIO',
  'NOTA_FISCAL_COMPRA',
  'REFERENCIA_COMERCIAL',
] as const;
export type TipoDeDocumentoCredito = (typeof TIPOS_DE_DOCUMENTO_CREDITO)[number];

/**
 * A tela de crédito só confirma que o documento foi recebido (fisicamente ou por outro canal),
 * sem upload (`frontend/src/api/credito.ts`: `registrarDocumento` só envia tipo e data). As
 * colunas de arquivo são preenchidas com estes valores fixos até o item que tratar upload de
 * fato (mesma lacuna já registrada para os anexos de orçamento no item 6).
 */
const NOME_ARQUIVO_SEM_UPLOAD = 'recebido_sem_arquivo_digital';
const CAMINHO_ARQUIVO_SEM_UPLOAD = '(documento físico — sem arquivo digital registrado)';

export const OPERACOES_DE_CREDITO = {
  LISTAR: 'UC07-listar-analises',
  BUSCAR: 'UC07-buscar-analise',
  BUSCAR_PENDENTE: 'UC07-buscar-analise-pendente',
  ABRIR: 'UC07-abrir-analise',
  REGISTRAR_RESULTADO: 'UC07-registrar-resultado',
  BUSCAR_ORCAMENTO: 'UC07-buscar-orcamento',
  LISTAR_DOCUMENTOS: 'UC07-listar-documentos',
  REGISTRAR_DOCUMENTO: 'UC07-registrar-documento',
} as const;

const TABELA = 'analise_credito';
const TABELA_DE_DOCUMENTOS = 'documento_analise_credito';
const TABELA_DE_ORCAMENTOS = 'orcamento';
const COLUNAS = [
  'id_analise',
  'id_cliente',
  'id_orcamento',
  'data_solicitacao',
  'resultado',
  'data_analise',
  'id_operador_fiscal',
];
/** Análise de crédito gravada. */
export interface AnaliseCredito {
  readonly idAnalise: number;
  readonly idCliente: number;
  readonly idOrcamento: number | null;
  readonly dataSolicitacao: string;
  readonly resultado: ResultadoDeCredito | null;
  readonly dataAnalise: string | null;
  readonly idOperadorFiscal: number | null;
}

/** Documento do checklist já marcado como recebido. */
export interface DocumentoDeCreditoRegistrado {
  readonly tipoDocumento: TipoDeDocumentoCredito;
  readonly dataRecebimento: string;
}

const esquemaDaAnalise = z.object({
  idAnalise: z.number().int(),
  idCliente: z.number().int(),
  idOrcamento: z.number().int().nullable(),
  dataSolicitacao: z.string(),
  resultado: z.enum(RESULTADOS_DE_CREDITO).nullable(),
  dataAnalise: z.string().nullable(),
  idOperadorFiscal: z.number().int().nullable(),
});

const esquemaDoDocumento = z.object({
  tipoDocumento: z.enum(TIPOS_DE_DOCUMENTO_CREDITO),
  dataRecebimento: z.string(),
});

const esquemaDoOrcamento = z.object({
  numeroOrcamento: z.number().int().nullable(),
  valorTotalProposta: z.string().nullable(),
});

function paraAnalise(linha: unknown): AnaliseCredito {
  return validarLinha(esquemaDaAnalise, linha, TABELA);
}

/** Acesso às análises de crédito e ao checklist de documentos, sempre pelo proxy. */
export class RepositorioDeAnalisesDeCredito {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Todas as análises, mais recentes primeiro. */
  async listar(): Promise<AnaliseCredito[]> {
    const linhas = await consultarTodas(
      this.proxy,
      { tabela: TABELA, campos: COLUNAS, ordenacao: [['id_analise', 'desc']] },
      OPERACOES_DE_CREDITO.LISTAR,
    );
    return linhas.map(paraAnalise);
  }

  /** Busca a análise pelo identificador; `null` se não existir. */
  async buscarPorId(idAnalise: number): Promise<AnaliseCredito | null> {
    const [linha] = await consultar(
      this.proxy,
      { tabela: TABELA, campos: COLUNAS, filtros: { e: [['id_analise', '=', idAnalise]] } },
      OPERACOES_DE_CREDITO.BUSCAR,
    );
    return linha === undefined ? null : paraAnalise(linha);
  }

  /** A análise ainda sem resultado do cliente, se houver (para não abrir duas ao mesmo tempo). */
  async buscarPendentePorCliente(idCliente: number): Promise<AnaliseCredito | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA,
        campos: COLUNAS,
        filtros: {
          e: [
            ['id_cliente', '=', idCliente],
            ['resultado', 'nulo'],
          ],
        },
        limite: 1,
      },
      OPERACOES_DE_CREDITO.BUSCAR_PENDENTE,
    );
    return linha === undefined ? null : paraAnalise(linha);
  }

  /** Abre a análise (resultado ainda nulo) e devolve o identificador gerado. */
  async abrir(dados: {
    idCliente: number;
    idOrcamento: number | null;
    dataSolicitacao: string;
  }): Promise<number> {
    const resposta = await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA,
        valores: {
          id_cliente: dados.idCliente,
          id_orcamento: dados.idOrcamento,
          data_solicitacao: dados.dataSolicitacao,
        },
        retornar: ['id_analise'],
      },
      OPERACOES_DE_CREDITO.ABRIR,
    );
    const [linha] = linhasDe(resposta) as { idAnalise?: number }[];
    if (linha?.idAnalise === undefined) {
      throw new ErroInterno(new Error('A abertura da análise de crédito não devolveu o id.'));
    }
    return linha.idAnalise;
  }

  /** Grava o resultado da análise (UC07, fiscal). */
  async registrarResultado(
    idAnalise: number,
    dados: { resultado: ResultadoDeCredito; dataAnalise: string; idOperadorFiscal: number },
  ): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA,
        filtros: { e: [['id_analise', '=', idAnalise]] },
        valores: {
          resultado: dados.resultado,
          data_analise: dados.dataAnalise,
          id_operador_fiscal: dados.idOperadorFiscal,
        },
      },
      OPERACOES_DE_CREDITO.REGISTRAR_RESULTADO,
    );
  }

  /** Número e valor do orçamento vinculado à análise, para exibir na tela do fiscal. */
  async buscarDadosDoOrcamento(
    idOrcamento: number,
  ): Promise<{ numeroOrcamento: number | null; valorTotalProposta: number | null } | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        campos: ['numero_orcamento', 'valor_total_proposta'],
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
      },
      OPERACOES_DE_CREDITO.BUSCAR_ORCAMENTO,
    );
    if (linha === undefined) {
      return null;
    }
    const validado = validarLinha(esquemaDoOrcamento, linha, TABELA_DE_ORCAMENTOS);
    return {
      numeroOrcamento: validado.numeroOrcamento,
      valorTotalProposta:
        validado.valorTotalProposta === null
          ? null
          : decimalParaCentavos(validado.valorTotalProposta),
    };
  }

  /** Documentos já marcados como recebidos nesta análise. */
  async listarDocumentos(idAnalise: number): Promise<DocumentoDeCreditoRegistrado[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_DOCUMENTOS,
        campos: ['tipo_documento', 'data_recebimento'],
        filtros: { e: [['id_analise', '=', idAnalise]] },
      },
      OPERACOES_DE_CREDITO.LISTAR_DOCUMENTOS,
    );
    return linhas.map((linha) => validarLinha(esquemaDoDocumento, linha, TABELA_DE_DOCUMENTOS));
  }

  /**
   * Marca o tipo de documento como recebido. Idempotente por tipo: se o documento já estava
   * marcado, apenas atualiza a data de recebimento.
   */
  async registrarDocumento(dados: {
    idAnalise: number;
    tipoDocumento: TipoDeDocumentoCredito;
    dataRecebimento: string;
  }): Promise<void> {
    const existentes = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_DOCUMENTOS,
        campos: ['id_documento'],
        filtros: {
          e: [
            ['id_analise', '=', dados.idAnalise],
            ['tipo_documento', '=', dados.tipoDocumento],
          ],
        },
        limite: 1,
      },
      OPERACOES_DE_CREDITO.LISTAR_DOCUMENTOS,
    );
    const [existente] = validarLinha(
      z.array(z.object({ idDocumento: z.number().int() })),
      existentes,
      TABELA_DE_DOCUMENTOS,
    );
    if (existente) {
      await this.proxy.executar(
        'dados.atualizar',
        {
          tabela: TABELA_DE_DOCUMENTOS,
          filtros: { e: [['id_documento', '=', existente.idDocumento]] },
          valores: { data_recebimento: dados.dataRecebimento },
        },
        OPERACOES_DE_CREDITO.REGISTRAR_DOCUMENTO,
      );
      return;
    }
    await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA_DE_DOCUMENTOS,
        valores: {
          id_analise: dados.idAnalise,
          tipo_documento: dados.tipoDocumento,
          nome_arquivo: NOME_ARQUIVO_SEM_UPLOAD,
          caminho_arquivo: CAMINHO_ARQUIVO_SEM_UPLOAD,
          data_recebimento: dados.dataRecebimento,
        },
      },
      OPERACOES_DE_CREDITO.REGISTRAR_DOCUMENTO,
    );
  }
}
