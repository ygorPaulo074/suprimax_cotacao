// UC24 — leitura e ajuste do estoque físico (`variacao_produto`) e do histórico de movimentações
// (`movimentacao_estoque`; docs/13, seção 13.7; docs/banco-de-dados/colunas.csv). É o único
// arquivo do módulo que conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  consultar,
  consultarTodas,
  emBlocos,
  MAXIMO_DE_VALORES_NO_FILTRO_EM,
  validarLinha,
  type ClienteDeProxy,
  type FiltroDoProxy,
} from '../../dados';
import { registrarMovimentacaoDeEstoque, TIPOS_DE_MOVIMENTACAO } from '../comum/estoque';
import type { TipoDeMovimentacao } from '../comum/estoque';

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_ESTOQUE = {
  LISTAR_VARIACOES: 'UC24-listar-variacoes',
  BUSCAR_VARIACAO: 'UC24-buscar-variacao',
  BUSCAR_PRODUTOS: 'UC24-buscar-produtos',
  LISTAR_MOVIMENTACOES: 'UC24-listar-movimentacoes',
  AJUSTAR: 'UC24-ajustar-estoque',
} as const;

const TABELA_DE_VARIACOES = 'variacao_produto';
const TABELA_DE_PRODUTOS = 'produto';
const TABELA_DE_MOVIMENTACOES = 'movimentacao_estoque';
const COLUNAS_DA_VARIACAO = [
  'id_variacao',
  'id_produto',
  'marca',
  'tamanho_embalagem',
  'quantidade_estoque',
];
const COLUNAS_DA_MOVIMENTACAO = [
  'id_movimentacao',
  'id_variacao',
  'tipo',
  'quantidade',
  'id_operador',
  'id_orcamento',
  'id_entrada',
  'motivo',
  'data_movimentacao',
];

/** Variação de produto, sem o saldo disponível (calculado pelo serviço com as reservas). */
export interface VariacaoDeEstoque {
  readonly idVariacao: number;
  readonly idProduto: number;
  readonly marca: string;
  readonly tamanhoEmbalagem: string;
  readonly quantidadeEstoque: number;
}

/** Movimentação registrada no histórico da variação. */
export interface Movimentacao {
  readonly idMovimentacao: number;
  readonly idVariacao: number;
  readonly tipo: TipoDeMovimentacao;
  readonly quantidade: number;
  readonly idOperador: number | null;
  readonly idOrcamento: number | null;
  readonly idEntrada: number | null;
  readonly motivo: string | null;
  readonly dataMovimentacao: string;
}

const esquemaDaVariacao = z.object({
  idVariacao: z.number().int(),
  idProduto: z.number().int(),
  marca: z.string(),
  tamanhoEmbalagem: z.string(),
  quantidadeEstoque: z.number().int(),
});

const esquemaDaMovimentacao = z.object({
  idMovimentacao: z.number().int(),
  idVariacao: z.number().int(),
  tipo: z.enum(TIPOS_DE_MOVIMENTACAO),
  quantidade: z.number().int(),
  idOperador: z.number().int().nullable(),
  idOrcamento: z.number().int().nullable(),
  idEntrada: z.number().int().nullable(),
  motivo: z.string().nullable(),
  dataMovimentacao: z.string(),
});

function paraVariacao(linha: unknown): VariacaoDeEstoque {
  return validarLinha(esquemaDaVariacao, linha, TABELA_DE_VARIACOES);
}

function paraMovimentacao(linha: unknown): Movimentacao {
  return validarLinha(esquemaDaMovimentacao, linha, TABELA_DE_MOVIMENTACOES);
}

/** Acesso ao estoque físico e ao histórico de movimentações, sempre pelo proxy. */
export class RepositorioDeEstoque {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /**
   * Variações cuja marca bate com `termo`, ou cujo produto bate (descrição, código interno ou
   * EAN). Sem `termo`, devolve todas. Em ordem alfabética da marca.
   */
  async listarVariacoes(termo?: string): Promise<VariacaoDeEstoque[]> {
    if (termo === undefined) {
      const linhas = await consultarTodas(
        this.proxy,
        { tabela: TABELA_DE_VARIACOES, campos: COLUNAS_DA_VARIACAO, ordenacao: [['marca', 'asc']] },
        OPERACOES_DE_ESTOQUE.LISTAR_VARIACOES,
      );
      return linhas.map(paraVariacao);
    }
    const [porMarca, idsDosProdutos] = await Promise.all([
      consultarTodas(
        this.proxy,
        {
          tabela: TABELA_DE_VARIACOES,
          campos: COLUNAS_DA_VARIACAO,
          filtros: { e: [['marca', 'contem', termo]] },
        },
        OPERACOES_DE_ESTOQUE.LISTAR_VARIACOES,
      ),
      this.buscarIdsDeProdutosPorTermo(termo),
    ]);
    const porProduto =
      idsDosProdutos.length === 0
        ? []
        : await consultarTodas(
            this.proxy,
            {
              tabela: TABELA_DE_VARIACOES,
              campos: COLUNAS_DA_VARIACAO,
              filtros: { e: [['id_produto', 'em', idsDosProdutos]] },
            },
            OPERACOES_DE_ESTOQUE.LISTAR_VARIACOES,
          );
    const vistos = new Set<number>();
    const variacoes: VariacaoDeEstoque[] = [];
    for (const linha of [...porMarca, ...porProduto]) {
      const variacao = paraVariacao(linha);
      if (!vistos.has(variacao.idVariacao)) {
        vistos.add(variacao.idVariacao);
        variacoes.push(variacao);
      }
    }
    return variacoes.sort((a, b) => a.marca.localeCompare(b.marca));
  }

  /** A variação pelo identificador; `null` se não existir. */
  async buscarPorId(idVariacao: number): Promise<VariacaoDeEstoque | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_VARIACOES,
        campos: COLUNAS_DA_VARIACAO,
        filtros: { e: [['id_variacao', '=', idVariacao]] },
      },
      OPERACOES_DE_ESTOQUE.BUSCAR_VARIACAO,
    );
    return linha === undefined ? null : paraVariacao(linha);
  }

  /** Descrição de cada produto pelo identificador, para exibir junto da variação. */
  async buscarDescricoesPorId(idsDosProdutos: readonly number[]): Promise<Map<number, string>> {
    const descricoes = new Map<number, string>();
    for (const bloco of emBlocos(idsDosProdutos, MAXIMO_DE_VALORES_NO_FILTRO_EM)) {
      if (bloco.length === 0) {
        continue;
      }
      const linhas = await consultarTodas(
        this.proxy,
        {
          tabela: TABELA_DE_PRODUTOS,
          campos: ['id_produto', 'descricao'],
          filtros: { e: [['id_produto', 'em', bloco]] },
        },
        OPERACOES_DE_ESTOQUE.BUSCAR_PRODUTOS,
      );
      for (const linha of linhas) {
        const { idProduto, descricao } = validarLinha(
          z.object({ idProduto: z.number().int(), descricao: z.string() }),
          linha,
          TABELA_DE_PRODUTOS,
        );
        descricoes.set(idProduto, descricao);
      }
    }
    return descricoes;
  }

  /** Histórico de movimentações da variação, mais recente primeiro. */
  async listarMovimentacoes(idVariacao: number): Promise<Movimentacao[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_MOVIMENTACOES,
        campos: COLUNAS_DA_MOVIMENTACAO,
        filtros: { e: [['id_variacao', '=', idVariacao]] },
        ordenacao: [['id_movimentacao', 'desc']],
      },
      OPERACOES_DE_ESTOQUE.LISTAR_MOVIMENTACOES,
    );
    return linhas.map(paraMovimentacao);
  }

  /**
   * Registra a movimentação AJUSTE e atualiza o estoque físico da variação, de forma incremental
   * (`novo = atual + quantidade`; negativo subtrai).
   */
  async registrarMovimentacao(dados: {
    idVariacao: number;
    tipo: TipoDeMovimentacao;
    quantidade: number;
    idOperador: number | null;
    motivo: string | null;
    quantidadeEstoqueAtual: number;
  }): Promise<void> {
    await registrarMovimentacaoDeEstoque(this.proxy, dados, OPERACOES_DE_ESTOQUE.AJUSTAR);
  }

  private async buscarIdsDeProdutosPorTermo(termo: string): Promise<number[]> {
    const filtros: FiltroDoProxy = {
      ou: [
        ['descricao', 'contem', termo],
        ['codigo_interno', 'contem', termo],
        ['ean', 'contem', termo],
      ],
    };
    const linhas = await consultarTodas(
      this.proxy,
      { tabela: TABELA_DE_PRODUTOS, campos: ['id_produto'], filtros },
      OPERACOES_DE_ESTOQUE.BUSCAR_PRODUTOS,
    );
    return linhas.map(
      (linha) =>
        validarLinha(z.object({ idProduto: z.number().int() }), linha, TABELA_DE_PRODUTOS)
          .idProduto,
    );
  }
}
