// UC04 — leitura e gravação das tabelas `produto`, `variacao_produto`, `faixa_preco` e `fardo`
// (docs/13, seções 13.7.4 a 13.7.7). É o único arquivo do módulo que conhece o proxy e os nomes
// das colunas, e o único que converte preço: DECIMAL em texto no banco, centavos no backend.
import { z } from 'zod';
import {
  centavosParaDecimal,
  consultar,
  consultarTodas,
  decimalParaCentavos,
  emBlocos,
  executarEmLotes,
  executarLote,
  linhasDoPasso,
  MAXIMO_DE_LINHAS_POR_ALTERACAO,
  MAXIMO_DE_LINHAS_POR_INSERCAO,
  MAXIMO_DE_VALORES_NO_FILTRO_EM,
  referenciaAoPasso,
  validarLinha,
  type ClienteDeProxy,
  type FiltroDoProxy,
  type PassoDoLote,
} from '../../dados';
import { ErroInterno } from '../../erros';
import { calcularSaldoDisponivel, somarReservasPorVariacao } from '../comum/estoque';
import type { PlanoDeAtualizacao } from './plano';

/** Identificação de cada chamada na auditoria do proxy (X-Operation-Id). */
export const OPERACOES_DE_PRODUTOS = {
  LISTAR: 'UC04-listar-produtos',
  BUSCAR: 'UC04-buscar-produto',
  CONFERIR_DUPLICIDADE: 'UC04-conferir-duplicidade',
  CONFERIR_USO: 'UC04-conferir-uso',
  CADASTRAR: 'UC04-cadastrar-produto',
  ATUALIZAR: 'UC04-atualizar-produto',
} as const;

const TABELA_DE_PRODUTOS = 'produto';
const TABELA_DE_VARIACOES = 'variacao_produto';
const TABELA_DE_FAIXAS = 'faixa_preco';
const TABELA_DE_FARDOS = 'fardo';
const COLUNAS_DO_PRODUTO = [
  'id_produto',
  'codigo_interno',
  'descricao',
  'ncm',
  'ean',
  'categoria',
  'ativo',
];
const PASSO_DO_PRODUTO = 'produto';

/** O que pode ser removido de um produto e é referenciado por outras tabelas. */
export type RegistroDeProduto = 'variacao' | 'faixa' | 'fardo';

/**
 * Tabelas e colunas que apontam para cada registro (docs/13, seção 13.7.23). Um registro
 * referenciado não pode ser excluído: o banco recusa pela chave estrangeira.
 */
const REFERENCIAS: Readonly<Record<RegistroDeProduto, readonly (readonly [string, string])[]>> = {
  variacao: [
    ['item_orcamento', 'id_variacao'],
    ['item_pedido', 'id_variacao'],
    ['movimentacao_estoque', 'id_variacao'],
    ['entrada_mercadoria', 'id_variacao'],
  ],
  faixa: [
    ['item_orcamento', 'id_faixa_preco'],
    ['item_resposta_orcamento', 'id_faixa_preco_aceita'],
  ],
  fardo: [
    ['item_orcamento', 'id_fardo'],
    ['item_pedido', 'id_fardo'],
  ],
};

/** Campos do produto que não dependem de variação. */
export interface CamposDoProduto {
  readonly codigoInterno: string;
  readonly descricao: string;
  /** 8 dígitos, ou `null` quando não se aplica. */
  readonly ncm: string | null;
  readonly ean: string | null;
  readonly categoria: string | null;
  readonly ativo: boolean;
}

/** Preço da venda avulsa a partir de uma quantidade. Preço em centavos. */
export interface FaixaDePreco {
  readonly idFaixaPreco: number;
  readonly quantidadeMinima: number;
  readonly precoUnitario: number;
}

/** Pacote fechado com preço fixo. Preço em centavos. */
export interface Fardo {
  readonly idFardo: number;
  readonly quantidadeUnidades: number;
  readonly precoFixo: number;
}

/** Marca e tamanho/embalagem de um produto: o item de estoque. */
export interface VariacaoDeProduto {
  readonly idVariacao: number;
  readonly marca: string;
  readonly tamanhoEmbalagem: string;
  /** Estoque físico. */
  readonly quantidadeEstoque: number;
  /**
   * Físico menos as reservas CONFIRMADA vigentes (RN14). Calculado de verdade por
   * {@link RepositorioDeProdutos.buscarVariacaoComPrecos} e por quem usa
   * {@link RepositorioDeProdutos.buscarReservadoPorVariacao} (UC15); no cadastro simples
   * (`listar`/`buscarPorId`) repete o estoque físico, para não pagar uma consulta extra onde o
   * saldo em tempo real não é necessário.
   */
  readonly saldoDisponivel: number;
  readonly faixasPreco: readonly FaixaDePreco[];
  readonly fardos: readonly Fardo[];
}

/** Produto com suas variações e preços. É o tipo `Produto` de `frontend/src/api/types.ts`. */
export interface Produto extends CamposDoProduto {
  readonly idProduto: number;
  readonly variacoes: readonly VariacaoDeProduto[];
}

/** Variação ainda não gravada, com seus preços. */
export interface VariacaoAInserir {
  readonly marca: string;
  readonly tamanhoEmbalagem: string;
  readonly quantidadeEstoque: number;
  readonly faixasPreco: readonly Omit<FaixaDePreco, 'idFaixaPreco'>[];
  readonly fardos: readonly Omit<Fardo, 'idFardo'>[];
}

/** Produto ainda não gravado. */
export interface ProdutoAInserir extends CamposDoProduto {
  readonly variacoes: readonly VariacaoAInserir[];
}

/** Campo único do produto que já pertence a outro produto. */
export type CampoDuplicado = 'codigoInterno' | 'ean';

const esquemaDaVariacao = z.object({
  idVariacao: z.number().int(),
  marca: z.string(),
  tamanhoEmbalagem: z.string(),
  quantidadeEstoque: z.number().int(),
});

const esquemaDoProduto = z.object({
  idProduto: z.number().int(),
  codigoInterno: z.string(),
  descricao: z.string(),
  ncm: z.string().nullable(),
  ean: z.string().nullable(),
  categoria: z.string().nullable(),
  ativo: z.boolean(),
  // Com `incluir`, o proxy devolve as linhas filhas em uma lista com o nome da tabela.
  variacaoProduto: z.array(esquemaDaVariacao),
});

const esquemaDaFaixa = z.object({
  idFaixaPreco: z.number().int(),
  idVariacao: z.number().int(),
  quantidadeMinima: z.number().int(),
  precoUnitario: z.string(),
});

const esquemaDoFardo = z.object({
  idFardo: z.number().int(),
  idVariacao: z.number().int(),
  quantidadeUnidades: z.number().int(),
  precoFixo: z.string(),
});

const esquemaDoConflito = z.object({ codigoInterno: z.string(), ean: z.string().nullable() });
const esquemaDoIdDoProduto = z.object({ idProduto: z.number().int() });

/** Colunas de `variacao_produto` usadas por {@link RepositorioDeProdutos.buscarVariacoesPorId}. */
const COLUNAS_DA_VARIACAO_SIMPLES = [
  'id_variacao',
  'id_produto',
  'marca',
  'tamanho_embalagem',
  'quantidade_estoque',
];

const esquemaDaVariacaoSimples = z.object({
  idVariacao: z.number().int(),
  idProduto: z.number().int(),
  marca: z.string(),
  tamanhoEmbalagem: z.string(),
  quantidadeEstoque: z.number().int(),
});

const esquemaDaDescricaoDoProduto = z.object({
  idProduto: z.number().int(),
  descricao: z.string(),
});

/** Variação com a descrição do produto ao qual pertence. */
export interface VariacaoComProduto {
  readonly idVariacao: number;
  readonly idProduto: number;
  readonly descricaoDoProduto: string;
  readonly marca: string;
  readonly tamanhoEmbalagem: string;
  readonly quantidadeEstoque: number;
}

type LinhaDeProduto = z.infer<typeof esquemaDoProduto>;

function valoresDoProduto(campos: CamposDoProduto): Record<string, unknown> {
  return {
    codigo_interno: campos.codigoInterno,
    descricao: campos.descricao,
    ncm: campos.ncm,
    ean: campos.ean,
    categoria: campos.categoria,
    ativo: campos.ativo,
  };
}

function agruparPorVariacao<T extends { idVariacao: number }>(
  linhas: readonly T[],
): Map<number, T[]> {
  const grupos = new Map<number, T[]>();
  for (const linha of linhas) {
    grupos.set(linha.idVariacao, [...(grupos.get(linha.idVariacao) ?? []), linha]);
  }
  return grupos;
}

/** Acesso aos produtos, variações e preços, sempre pelo proxy. */
export class RepositorioDeProdutos {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /**
   * Lista os produtos em ordem alfabética da descrição.
   *
   * @param termo Trecho da descrição, do código interno ou do EAN; sem ele, vêm todos.
   */
  async listar(termo?: string): Promise<Produto[]> {
    const filtros: FiltroDoProxy | undefined =
      termo === undefined
        ? undefined
        : {
            ou: [
              ['descricao', 'contem', termo],
              ['codigo_interno', 'contem', termo],
              ['ean', 'contem', termo],
            ],
          };
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_PRODUTOS,
        campos: COLUNAS_DO_PRODUTO,
        ...(filtros && { filtros }),
        incluir: [TABELA_DE_VARIACOES],
        ordenacao: [['descricao', 'asc']],
      },
      OPERACOES_DE_PRODUTOS.LISTAR,
    );
    return this.montar(linhas, OPERACOES_DE_PRODUTOS.LISTAR);
  }

  /** Busca o produto pelo identificador, com variações e preços; `null` se não existir. */
  async buscarPorId(idProduto: number): Promise<Produto | null> {
    const linhas = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_PRODUTOS,
        campos: COLUNAS_DO_PRODUTO,
        filtros: { e: [['id_produto', '=', idProduto]] },
        incluir: [TABELA_DE_VARIACOES],
        limite: 1,
      },
      OPERACOES_DE_PRODUTOS.BUSCAR,
    );
    const [produto] = await this.montar(linhas, OPERACOES_DE_PRODUTOS.BUSCAR);
    return produto ?? null;
  }

  /**
   * Variações pelo identificador, com a descrição do produto (item 6: item de pedido e de
   * orçamento só guardam `id_variacao`). Ignora identificadores inexistentes.
   *
   * O proxy não faz junção com a tabela pai, então a descrição é buscada em uma segunda consulta.
   */
  async buscarVariacoesPorId(idsDasVariacoes: readonly number[]): Promise<VariacaoComProduto[]> {
    if (idsDasVariacoes.length === 0) {
      return [];
    }
    const variacoes: z.infer<typeof esquemaDaVariacaoSimples>[] = [];
    for (const bloco of emBlocos(idsDasVariacoes, MAXIMO_DE_VALORES_NO_FILTRO_EM)) {
      const linhas = await consultarTodas(
        this.proxy,
        {
          tabela: TABELA_DE_VARIACOES,
          campos: COLUNAS_DA_VARIACAO_SIMPLES,
          filtros: { e: [['id_variacao', 'em', bloco]] },
        },
        OPERACOES_DE_PRODUTOS.BUSCAR,
      );
      variacoes.push(
        ...linhas.map((linha) =>
          validarLinha(esquemaDaVariacaoSimples, linha, TABELA_DE_VARIACOES),
        ),
      );
    }
    const idsDosProdutos = [...new Set(variacoes.map((variacao) => variacao.idProduto))];
    const descricoes = await this.buscarDescricoesPorId(idsDosProdutos);
    return variacoes.map((variacao) => ({
      ...variacao,
      descricaoDoProduto: descricoes.get(variacao.idProduto) ?? '',
    }));
  }

  /**
   * Uma variação com suas faixas de preço e fardos, para calcular o preço de um item de
   * orçamento (UC15-18); `null` se não existir.
   */
  async buscarVariacaoComPrecos(idVariacao: number): Promise<VariacaoDeProduto | null> {
    const [variacao] = await this.buscarVariacoesPorId([idVariacao]);
    if (!variacao) {
      return null;
    }
    const [faixas, fardos, reservas] = await Promise.all([
      this.listarFaixas([idVariacao], OPERACOES_DE_PRODUTOS.BUSCAR),
      this.listarFardos([idVariacao], OPERACOES_DE_PRODUTOS.BUSCAR),
      somarReservasPorVariacao(this.proxy, [idVariacao], OPERACOES_DE_PRODUTOS.BUSCAR),
    ]);
    return {
      idVariacao: variacao.idVariacao,
      marca: variacao.marca,
      tamanhoEmbalagem: variacao.tamanhoEmbalagem,
      quantidadeEstoque: variacao.quantidadeEstoque,
      saldoDisponivel: calcularSaldoDisponivel(
        variacao.quantidadeEstoque,
        reservas.get(idVariacao) ?? 0,
      ),
      faixasPreco: faixas.get(idVariacao) ?? [],
      fardos: fardos.get(idVariacao) ?? [],
    };
  }

  /** Descrição de cada produto pelo identificador, para exibir junto de uma variação. */
  private async buscarDescricoesPorId(
    idsDosProdutos: readonly number[],
  ): Promise<Map<number, string>> {
    const descricoes = new Map<number, string>();
    if (idsDosProdutos.length === 0) {
      return descricoes;
    }
    for (const bloco of emBlocos(idsDosProdutos, MAXIMO_DE_VALORES_NO_FILTRO_EM)) {
      const linhas = await consultarTodas(
        this.proxy,
        {
          tabela: TABELA_DE_PRODUTOS,
          campos: ['id_produto', 'descricao'],
          filtros: { e: [['id_produto', 'em', bloco]] },
        },
        OPERACOES_DE_PRODUTOS.BUSCAR,
      );
      for (const linha of linhas) {
        const produto = validarLinha(esquemaDaDescricaoDoProduto, linha, TABELA_DE_PRODUTOS);
        descricoes.set(produto.idProduto, produto.descricao);
      }
    }
    return descricoes;
  }

  /**
   * Campos únicos que já pertencem a outro produto.
   *
   * @param idIgnorado Produto que está sendo alterado, para não conflitar consigo mesmo.
   */
  async buscarCamposDuplicados(
    { codigoInterno, ean }: Pick<CamposDoProduto, 'codigoInterno' | 'ean'>,
    idIgnorado?: number,
  ): Promise<CampoDuplicado[]> {
    const iguais: FiltroDoProxy = {
      ou: [
        ['codigo_interno', '=', codigoInterno],
        ...(ean === null ? [] : [['ean', '=', ean] as const]),
      ],
    };
    const linhas = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_PRODUTOS,
        campos: ['codigo_interno', 'ean'],
        filtros:
          idIgnorado === undefined ? iguais : { e: [['id_produto', '!=', idIgnorado], iguais] },
      },
      OPERACOES_DE_PRODUTOS.CONFERIR_DUPLICIDADE,
    );
    const outros = linhas.map((linha) =>
      validarLinha(esquemaDoConflito, linha, TABELA_DE_PRODUTOS),
    );
    const duplicados: CampoDuplicado[] = [];
    if (outros.some((outro) => outro.codigoInterno === codigoInterno)) {
      duplicados.push('codigoInterno');
    }
    if (ean !== null && outros.some((outro) => outro.ean === ean)) {
      duplicados.push('ean');
    }
    return duplicados;
  }

  /** Indica se algum dos registros é referenciado por pedido, orçamento ou estoque. */
  async existeReferencia(registro: RegistroDeProduto, ids: readonly number[]): Promise<boolean> {
    for (const bloco of emBlocos(ids, MAXIMO_DE_VALORES_NO_FILTRO_EM)) {
      for (const [tabela, coluna] of REFERENCIAS[registro]) {
        const linhas = await consultar(
          this.proxy,
          { tabela, campos: [coluna], filtros: { e: [[coluna, 'em', bloco]] }, limite: 1 },
          OPERACOES_DE_PRODUTOS.CONFERIR_USO,
        );
        if (linhas.length > 0) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Grava o produto, as variações e os preços em uma única transação.
   *
   * @returns O identificador do produto criado.
   */
  async inserir(produto: ProdutoAInserir): Promise<number> {
    const resultados = await executarLote(
      this.proxy,
      [
        {
          id: PASSO_DO_PRODUTO,
          operacao: 'dados.inserir',
          payload: {
            tabela: TABELA_DE_PRODUTOS,
            valores: valoresDoProduto(produto),
            retornar: ['id_produto'],
          },
        },
        ...this.passosDasVariacoesNovas(
          produto.variacoes,
          referenciaAoPasso(PASSO_DO_PRODUTO, 0, 'id_produto'),
        ),
      ],
      OPERACOES_DE_PRODUTOS.CADASTRAR,
    );
    const [linha] = linhasDoPasso(resultados, PASSO_DO_PRODUTO);
    if (linha === undefined) {
      throw new ErroInterno(new Error('O cadastro do produto não devolveu o identificador.'));
    }
    return validarLinha(esquemaDoIdDoProduto, linha, TABELA_DE_PRODUTOS).idProduto;
  }

  /**
   * Grava as mudanças do plano.
   *
   * O produto, as variações novas com seus preços e cada variação removida com seus preços são
   * gravados em transação. As demais mudanças de preço seguem na mesma transação enquanto couber
   * no limite de passos do proxy; uma alteração muito grande é dividida em mais de uma transação,
   * e uma falha no meio deixa gravadas as mudanças das transações anteriores.
   */
  async aplicar(plano: PlanoDeAtualizacao): Promise<void> {
    const grupos: PassoDoLote[][] = [];
    const sozinho = (passo: PassoDoLote) => grupos.push([passo]);

    if (plano.produto) {
      sozinho(
        this.passoDeAtualizacao(
          PASSO_DO_PRODUTO,
          TABELA_DE_PRODUTOS,
          'id_produto',
          plano.idProduto,
          valoresDoProduto(plano.produto),
        ),
      );
    }
    if (plano.variacoesNovas.length > 0) {
      grupos.push(this.passosDasVariacoesNovas(plano.variacoesNovas, plano.idProduto));
    }
    for (const { idVariacao, marca, tamanhoEmbalagem } of plano.variacoesAlteradas) {
      sozinho(
        this.passoDeAtualizacao(
          `variacao_${idVariacao}`,
          TABELA_DE_VARIACOES,
          'id_variacao',
          idVariacao,
          { marca, tamanho_embalagem: tamanhoEmbalagem },
        ),
      );
    }

    this.passosDeExclusao(
      'remover_faixas',
      TABELA_DE_FAIXAS,
      'id_faixa_preco',
      plano.idsDasFaixasRemovidas,
    ).forEach(sozinho);
    this.passosDeExclusao(
      'remover_fardos',
      TABELA_DE_FARDOS,
      'id_fardo',
      plano.idsDosFardosRemovidos,
    ).forEach(sozinho);
    for (const { idFaixaPreco, precoUnitario } of plano.faixasAlteradas) {
      sozinho(
        this.passoDeAtualizacao(
          `faixa_${idFaixaPreco}`,
          TABELA_DE_FAIXAS,
          'id_faixa_preco',
          idFaixaPreco,
          {
            preco_unitario: centavosParaDecimal(precoUnitario),
          },
        ),
      );
    }
    for (const { idFardo, precoFixo } of plano.fardosAlterados) {
      sozinho(
        this.passoDeAtualizacao(`fardo_${idFardo}`, TABELA_DE_FARDOS, 'id_fardo', idFardo, {
          preco_fixo: centavosParaDecimal(precoFixo),
        }),
      );
    }
    this.passosDeInsercao(
      'faixas',
      TABELA_DE_FAIXAS,
      plano.faixasNovas.map((faixa) => ({
        id_variacao: faixa.idVariacao,
        quantidade_minima: faixa.quantidadeMinima,
        preco_unitario: centavosParaDecimal(faixa.precoUnitario),
      })),
    ).forEach(sozinho);
    this.passosDeInsercao(
      'fardos',
      TABELA_DE_FARDOS,
      plano.fardosNovos.map((fardo) => ({
        id_variacao: fardo.idVariacao,
        quantidade_unidades: fardo.quantidadeUnidades,
        preco_fixo: centavosParaDecimal(fardo.precoFixo),
      })),
    ).forEach(sozinho);

    for (const { idVariacao, idsDasFaixas, idsDosFardos } of plano.variacoesRemovidas) {
      grupos.push([
        ...this.passosDeExclusao(
          `remover_faixas_da_${idVariacao}`,
          TABELA_DE_FAIXAS,
          'id_faixa_preco',
          idsDasFaixas,
        ),
        ...this.passosDeExclusao(
          `remover_fardos_da_${idVariacao}`,
          TABELA_DE_FARDOS,
          'id_fardo',
          idsDosFardos,
        ),
        {
          id: `remover_variacao_${idVariacao}`,
          operacao: 'dados.excluir',
          payload: {
            tabela: TABELA_DE_VARIACOES,
            filtros: { e: [['id_variacao', '=', idVariacao]] },
          },
        },
      ]);
    }

    await executarEmLotes(this.proxy, grupos, OPERACOES_DE_PRODUTOS.ATUALIZAR);
  }

  // ------------------------------------------------------------------------------------------
  // Leitura

  /**
   * Junta cada produto às suas variações e busca os preços delas.
   *
   * `saldoDisponivel` não é calculado aqui (o cadastro de produtos não precisa dele, e isso
   * evitaria uma consulta extra por listagem): quem precisa do saldo em tempo real — a busca do
   * catálogo do orçamento (UC15) e o cálculo de preço de um item (UC15-18) — usa
   * {@link buscarSaldoDisponivel} ou {@link buscarVariacaoComPrecos}.
   */
  private async montar(linhas: readonly unknown[], operationId: string): Promise<Produto[]> {
    const produtos = linhas.map((linha) =>
      validarLinha(esquemaDoProduto, linha, TABELA_DE_PRODUTOS),
    );
    const ids = produtos.flatMap((produto) => produto.variacaoProduto.map((v) => v.idVariacao));
    const [faixas, fardos] = await Promise.all([
      this.listarFaixas(ids, operationId),
      this.listarFardos(ids, operationId),
    ]);
    return produtos.map((produto) => this.paraProduto(produto, faixas, fardos));
  }

  private paraProduto(
    { variacaoProduto, ...produto }: LinhaDeProduto,
    faixas: Map<number, FaixaDePreco[]>,
    fardos: Map<number, Fardo[]>,
  ): Produto {
    const variacoes = [...variacaoProduto]
      .sort((a, b) => a.idVariacao - b.idVariacao)
      .map((variacao) => ({
        ...variacao,
        // Placeholder: sem reserva somada, o disponível é o físico. Ver o comentário de `montar`.
        saldoDisponivel: variacao.quantidadeEstoque,
        faixasPreco: faixas.get(variacao.idVariacao) ?? [],
        fardos: fardos.get(variacao.idVariacao) ?? [],
      }));
    return { ...produto, variacoes };
  }

  /**
   * Quantidade reservada (status CONFIRMADA) de cada variação, para calcular o saldo disponível
   * (RN14: físico − reservado). Usado pela busca do catálogo do orçamento (UC15), onde o saldo
   * precisa estar em dia; o chamador soma ao estoque físico que já tem em mãos.
   */
  async buscarReservadoPorVariacao(
    idsDasVariacoes: readonly number[],
  ): Promise<Map<number, number>> {
    if (idsDasVariacoes.length === 0) {
      return new Map();
    }
    return somarReservasPorVariacao(this.proxy, idsDasVariacoes, OPERACOES_DE_PRODUTOS.BUSCAR);
  }

  private async listarFaixas(
    idsDasVariacoes: readonly number[],
    operationId: string,
  ): Promise<Map<number, FaixaDePreco[]>> {
    const linhas = await this.listarPrecos(
      TABELA_DE_FAIXAS,
      'quantidade_minima',
      idsDasVariacoes,
      operationId,
    );
    const faixas = linhas.map((linha) => validarLinha(esquemaDaFaixa, linha, TABELA_DE_FAIXAS));
    return new Map(
      [...agruparPorVariacao(faixas)].map(([idVariacao, grupo]) => [
        idVariacao,
        grupo.map(({ idFaixaPreco, quantidadeMinima, precoUnitario }) => ({
          idFaixaPreco,
          quantidadeMinima,
          precoUnitario: decimalParaCentavos(precoUnitario),
        })),
      ]),
    );
  }

  private async listarFardos(
    idsDasVariacoes: readonly number[],
    operationId: string,
  ): Promise<Map<number, Fardo[]>> {
    const linhas = await this.listarPrecos(
      TABELA_DE_FARDOS,
      'quantidade_unidades',
      idsDasVariacoes,
      operationId,
    );
    const fardos = linhas.map((linha) => validarLinha(esquemaDoFardo, linha, TABELA_DE_FARDOS));
    return new Map(
      [...agruparPorVariacao(fardos)].map(([idVariacao, grupo]) => [
        idVariacao,
        grupo.map(({ idFardo, quantidadeUnidades, precoFixo }) => ({
          idFardo,
          quantidadeUnidades,
          precoFixo: decimalParaCentavos(precoFixo),
        })),
      ]),
    );
  }

  /** Linhas de preço das variações, da menor para a maior quantidade. */
  private async listarPrecos(
    tabela: string,
    colunaDaQuantidade: string,
    idsDasVariacoes: readonly number[],
    operationId: string,
  ): Promise<unknown[]> {
    const paginas = await Promise.all(
      emBlocos(idsDasVariacoes, MAXIMO_DE_VALORES_NO_FILTRO_EM).map((bloco) =>
        consultarTodas(
          this.proxy,
          {
            tabela,
            filtros: { e: [['id_variacao', 'em', bloco]] },
            ordenacao: [[colunaDaQuantidade, 'asc']],
          },
          operationId,
        ),
      ),
    );
    return paginas.flat();
  }

  // ------------------------------------------------------------------------------------------
  // Passos de gravação

  /**
   * Passos que criam as variações e, depois de todas elas, seus preços. Cada variação tem o seu
   * passo de inserção, e os preços apontam para o identificador que esse passo devolve: assim um
   * preço nunca é ligado à variação errada.
   *
   * @param idProduto Identificador do produto, ou a referência ao passo que o cria.
   */
  private passosDasVariacoesNovas(
    variacoes: readonly VariacaoAInserir[],
    idProduto: number | string,
  ): PassoDoLote[] {
    const passoDa = (indice: number) => `variacao_nova_${indice}`;
    const idDa = (indice: number) => referenciaAoPasso(passoDa(indice), 0, 'id_variacao');
    const insercoes = variacoes.map((variacao, indice): PassoDoLote => ({
      id: passoDa(indice),
      operacao: 'dados.inserir',
      payload: {
        tabela: TABELA_DE_VARIACOES,
        valores: {
          id_produto: idProduto,
          marca: variacao.marca,
          tamanho_embalagem: variacao.tamanhoEmbalagem,
          quantidade_estoque: variacao.quantidadeEstoque,
        },
        retornar: ['id_variacao'],
      },
    }));
    const faixas = variacoes.flatMap((variacao, indice) =>
      variacao.faixasPreco.map((faixa) => ({
        id_variacao: idDa(indice),
        quantidade_minima: faixa.quantidadeMinima,
        preco_unitario: centavosParaDecimal(faixa.precoUnitario),
      })),
    );
    const fardos = variacoes.flatMap((variacao, indice) =>
      variacao.fardos.map((fardo) => ({
        id_variacao: idDa(indice),
        quantidade_unidades: fardo.quantidadeUnidades,
        preco_fixo: centavosParaDecimal(fardo.precoFixo),
      })),
    );
    return [
      ...insercoes,
      ...this.passosDeInsercao('faixas_das_novas', TABELA_DE_FAIXAS, faixas),
      ...this.passosDeInsercao('fardos_das_novas', TABELA_DE_FARDOS, fardos),
    ];
  }

  private passosDeInsercao(
    prefixo: string,
    tabela: string,
    linhas: readonly Record<string, unknown>[],
  ): PassoDoLote[] {
    return emBlocos(linhas, MAXIMO_DE_LINHAS_POR_INSERCAO).map((valores, indice) => ({
      id: `${prefixo}_${indice}`,
      operacao: 'dados.inserir',
      payload: { tabela, valores, retornar: ['id_variacao'] },
    }));
  }

  private passosDeExclusao(
    prefixo: string,
    tabela: string,
    colunaDoId: string,
    ids: readonly number[],
  ): PassoDoLote[] {
    return emBlocos(ids, MAXIMO_DE_LINHAS_POR_ALTERACAO).map((bloco, indice) => ({
      id: `${prefixo}_${indice}`,
      operacao: 'dados.excluir',
      payload: { tabela, filtros: { e: [[colunaDoId, 'em', bloco]] } },
    }));
  }

  private passoDeAtualizacao(
    id: string,
    tabela: string,
    colunaDoId: string,
    valorDoId: number,
    valores: Record<string, unknown>,
  ): PassoDoLote {
    return {
      id,
      operacao: 'dados.atualizar',
      payload: { tabela, filtros: { e: [[colunaDoId, '=', valorDoId]] }, valores },
    };
  }
}
