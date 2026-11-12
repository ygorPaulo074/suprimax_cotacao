// UC01, UC05, UC14-19 — leitura e gravação de `orcamento`, `item_orcamento`, `historico_orcamento`
// e `anexo_orcamento`, e a operação nomeada `orcamento.emitir` (docs/12, seção 12.8.3). É o único
// arquivo do módulo que conhece o proxy e os nomes das colunas.
import { z } from 'zod';
import {
  centavosParaDecimal,
  consultar,
  consultarTodas,
  decimalParaCentavos,
  validarLinha,
  type ClienteDeProxy,
  type FiltroDoProxy,
} from '../../dados';
import { ErroProxy } from '../../dados/proxyCliente';
import { CODIGOS_DO_PROXY } from '../../dados/traducaoDeErros';
import { ErroDeEstoqueInsuficiente, ErroDeOrcamentoNaoEncontrado } from '../../erros';
import type { Granularidade } from '../pedidos/repositorio';

export const STATUS_DO_ORCAMENTO = [
  'RASCUNHO',
  'PENDENTE_CREDITO',
  'ABERTO',
  'ALTERACAO_SOLICITADA',
  'ACEITO',
  'RECUSADO',
  'CANCELADO',
  'SUBSTITUIDO',
  'EXPIRADO',
] as const;
export type StatusDoOrcamento = (typeof STATUS_DO_ORCAMENTO)[number];

/** Status em que o operador ainda pode mudar itens e condições (RN25, docs/13 seção 4.6). */
export const STATUS_DO_ORCAMENTO_EDITAVEIS: ReadonlySet<StatusDoOrcamento> = new Set([
  'RASCUNHO',
  'PENDENTE_CREDITO',
  'ALTERACAO_SOLICITADA',
]);

/**
 * Status "em aberto" (RF04, RF17; docs/01): ainda em elaboração ou aguardando o vendedor/cliente.
 * Recusado, cancelado, substituído e expirado são encerrados; aceito é uma compra fechada, não
 * uma pendência — nenhum dos dois conta como em aberto.
 */
export const STATUS_DO_ORCAMENTO_EM_ABERTO: ReadonlySet<StatusDoOrcamento> = new Set([
  'RASCUNHO',
  'PENDENTE_CREDITO',
  'ABERTO',
  'ALTERACAO_SOLICITADA',
]);

export const CONDICOES_DE_PAGAMENTO = [
  'ADIANTADO_100',
  'BOLETO',
  'PARCELADO',
  'ADIANTADO_50_50',
] as const;
export const MODALIDADES_DE_FRETE = ['CIF', 'FOB'] as const;
export const ORIGENS_DE_TRANSPORTADORA = ['SUPRIMAX', 'CLIENTE'] as const;
export const TIPOS_DE_EVENTO_HISTORICO = ['MUDANCA_STATUS', 'ATUALIZACAO_FOLLOWUP'] as const;
export const TIPOS_DE_ANEXO = ['DESCRITIVO_TECNICO', 'MATERIAL_APOIO'] as const;

export const OPERACOES_DE_ORCAMENTOS = {
  CRIAR: 'UC14-criar-orcamento',
  LISTAR: 'UC01-listar-orcamentos',
  BUSCAR: 'UC01-buscar-orcamento',
  ATUALIZAR_CABECALHO: 'UC14-atualizar-cabecalho',
  LISTAR_ITENS: 'UC15-listar-itens',
  INSERIR_ITEM: 'UC15-inserir-item',
  ATUALIZAR_ITEM: 'UC16-atualizar-item',
  REMOVER_ITEM: 'UC17-remover-item',
  ATUALIZAR_CONDICOES: 'UC18-atualizar-condicoes',
  EMITIR: 'UC19-emitir-orcamento',
  CANCELAR: 'UC19-cancelar-orcamento',
  LISTAR_HISTORICO: 'UC01-listar-historico',
  REGISTRAR_HISTORICO: 'UC01-registrar-historico',
  LISTAR_ANEXOS: 'UC19-listar-anexos',
  LISTAR_VERSOES: 'UC01-listar-versoes',
} as const;

const TABELA_DE_ORCAMENTOS = 'orcamento';
const TABELA_DE_ITENS = 'item_orcamento';
const TABELA_DE_HISTORICO = 'historico_orcamento';
const TABELA_DE_ANEXOS = 'anexo_orcamento';

const decimalOpcional = z
  .string()
  .nullable()
  .transform((valor) => (valor === null ? null : decimalParaCentavos(valor)));

const esquemaDoOrcamento = z.object({
  idOrcamento: z.number().int(),
  numeroOrcamento: z.number().int().nullable(),
  idCliente: z.number().int(),
  idOperador: z.number().int(),
  idEnderecoEntrega: z.number().int().nullable(),
  idPedido: z.number().int().nullable(),
  idOrcamentoOrigem: z.number().int().nullable(),
  dataCriacao: z.string(),
  dataUltimaEdicao: z.string(),
  dataEncerramento: z.string().nullable(),
  dataEmissao: z.string().nullable(),
  dataValidade: z.string().nullable(),
  status: z.enum(STATUS_DO_ORCAMENTO),
  motivoExpiracao: z.string().nullable(),
  numeroSolicitacaoCompra: z.string().nullable(),
  contatoSolicitacao: z.string().nullable(),
  prazoEntregaDias: z.number().int().nullable(),
  primeiraCompra: z.boolean(),
  condicaoPagamento: z.enum(CONDICOES_DE_PAGAMENTO).nullable(),
  prazoDias: z.number().int().nullable(),
  numeroParcelas: z.number().int().nullable(),
  modalidadeFrete: z.enum(MODALIDADES_DE_FRETE).nullable(),
  origemTransportadora: z.enum(ORIGENS_DE_TRANSPORTADORA).nullable(),
  transportadora: z.string().nullable(),
  valorFrete: decimalOpcional,
  freteProvisorio: z.boolean(),
  valorTotalItens: decimalOpcional,
  valorTotalImposto: decimalOpcional,
  valorTotalProposta: decimalOpcional,
  justificativa: z.string().nullable(),
  chaveSeguranca: z.string().nullable(),
});
export type Orcamento = z.infer<typeof esquemaDoOrcamento>;

/** Retorno de `orcamento.emitir` (docs/12, seção 12.8.3): só estes três campos. */
const esquemaDaEmissao = z.object({
  idOrcamento: z.number().int(),
  numeroOrcamento: z.number().int(),
  dataValidade: z.string(),
});
export type EmissaoDoOrcamento = z.infer<typeof esquemaDaEmissao>;

const esquemaDoItem = z.object({
  idItem: z.number().int(),
  idOrcamento: z.number().int(),
  idVariacao: z.number().int(),
  granularidade: z.enum(['FARDO', 'AVULSO']),
  idFardo: z.number().int().nullable(),
  quantidadeFardos: z.number().int().nullable(),
  idFaixaPreco: z.number().int().nullable(),
  quantidadeAvulsa: z.number().int().nullable(),
  precoUnitarioAplicado: z.string().transform(decimalParaCentavos),
  valorImposto: z.string().transform(decimalParaCentavos),
  valorTotalItem: z.string().transform(decimalParaCentavos),
  aprovacaoHerdada: z.boolean(),
});
export type ItemDoOrcamento = z.infer<typeof esquemaDoItem>;

const esquemaDoHistorico = z.object({
  idHistorico: z.number().int(),
  idOrcamento: z.number().int(),
  idOperador: z.number().int().nullable(),
  tipoEvento: z.enum(TIPOS_DE_EVENTO_HISTORICO),
  statusAnterior: z.enum(STATUS_DO_ORCAMENTO).nullable(),
  statusNovo: z.enum(STATUS_DO_ORCAMENTO),
  observacao: z.string().nullable(),
  dataRegistro: z.string(),
});
export type EventoDoHistorico = z.infer<typeof esquemaDoHistorico>;

const esquemaDoAnexo = z.object({
  idAnexo: z.number().int(),
  idOrcamento: z.number().int(),
  tipoAnexo: z.enum(TIPOS_DE_ANEXO),
  nomeArquivo: z.string(),
  caminhoArquivo: z.string(),
  tamanhoBytes: z.number().int().nullable(),
  dataAnexo: z.string(),
});
export type AnexoDoOrcamento = z.infer<typeof esquemaDoAnexo>;

const esquemaDoIdDoOrcamento = z.object({ idOrcamento: z.number().int() });

/** Cabeçalho ainda não gravado de um orçamento novo (UC14). */
export interface OrcamentoAInserir {
  readonly idCliente: number;
  readonly idOperador: number;
  readonly idEnderecoEntrega: number | null;
  readonly idPedido: number | null;
  readonly numeroSolicitacaoCompra: string | null;
  readonly contatoSolicitacao: string | null;
  readonly prazoEntregaDias: number | null;
  readonly primeiraCompra: boolean;
}

/** Item ainda não gravado (UC15). */
export interface ItemAInserir {
  readonly idVariacao: number;
  readonly granularidade: Granularidade;
  readonly idFardo: number | null;
  readonly quantidadeFardos: number | null;
  readonly idFaixaPreco: number | null;
  readonly quantidadeAvulsa: number | null;
  readonly precoUnitarioAplicado: number;
  readonly valorImposto: number;
  readonly valorTotalItem: number;
  readonly aprovacaoHerdada: boolean;
}

/** Alterações de cabeçalho aceitas em `PATCH /orcamentos/:id` (UC14). */
export interface AlteracaoDeCabecalho {
  readonly numeroSolicitacaoCompra?: string | null;
  readonly contatoSolicitacao?: string | null;
  readonly idEnderecoEntrega?: number | null;
  readonly prazoEntregaDias?: number | null;
}

/** Condições comerciais gravadas em `PUT /orcamentos/:id/condicoes` (UC18). */
export interface AlteracaoDeCondicoes {
  readonly condicaoPagamento: string | null;
  readonly prazoDias: number | null;
  readonly numeroParcelas: number | null;
  readonly modalidadeFrete: string | null;
  readonly origemTransportadora: string | null;
  readonly transportadora: string | null;
  readonly valorFrete: number | null;
  readonly freteProvisorio: boolean;
  readonly valorTotalProposta: number | null;
}

/** Totais recalculados depois de uma mudança nos itens (UC15-17). */
export interface TotaisDoOrcamento {
  readonly valorTotalItens: number | null;
  readonly valorTotalImposto: number | null;
  readonly valorTotalProposta: number | null;
}

function valoresDecimais(centavos: number | null): string | null {
  return centavos === null ? null : centavosParaDecimal(centavos);
}

/** Acesso aos orçamentos, itens, histórico e anexos, sempre pelo proxy. */
export class RepositorioDeOrcamentos {
  constructor(private readonly proxy: ClienteDeProxy) {}

  /** Cria o orçamento em RASCUNHO e devolve o identificador. */
  async criar(dados: OrcamentoAInserir, agora: Date): Promise<number> {
    const resposta = await this.proxy.executar<{ dados: unknown[] }>(
      'dados.inserir',
      {
        tabela: TABELA_DE_ORCAMENTOS,
        valores: {
          id_cliente: dados.idCliente,
          id_operador: dados.idOperador,
          id_endereco_entrega: dados.idEnderecoEntrega,
          id_pedido: dados.idPedido,
          numero_solicitacao_compra: dados.numeroSolicitacaoCompra,
          contato_solicitacao: dados.contatoSolicitacao,
          prazo_entrega_dias: dados.prazoEntregaDias,
          primeira_compra: dados.primeiraCompra,
          data_criacao: agora.toISOString(),
          data_ultima_edicao: agora.toISOString(),
        },
        retornar: ['id_orcamento'],
      },
      OPERACOES_DE_ORCAMENTOS.CRIAR,
    );
    const [linha] = resposta.dados;
    return validarLinha(esquemaDoIdDoOrcamento, linha, TABELA_DE_ORCAMENTOS).idOrcamento;
  }

  /** Lista os orçamentos que atendem ao filtro, do mais recente para o mais antigo. */
  async listar(filtros?: FiltroDoProxy): Promise<Orcamento[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        ...(filtros && { filtros }),
        ordenacao: [['id_orcamento', 'desc']],
      },
      OPERACOES_DE_ORCAMENTOS.LISTAR,
    );
    return linhas.map((linha) => validarLinha(esquemaDoOrcamento, linha, TABELA_DE_ORCAMENTOS));
  }

  /** Busca o orçamento pelo identificador; `null` se não existir. */
  async buscarPorId(idOrcamento: number): Promise<Orcamento | null> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        limite: 1,
      },
      OPERACOES_DE_ORCAMENTOS.BUSCAR,
    );
    return linha === undefined
      ? null
      : validarLinha(esquemaDoOrcamento, linha, TABELA_DE_ORCAMENTOS);
  }

  /** Itens do orçamento, na ordem de inclusão. */
  async listarItens(idOrcamento: number): Promise<ItemDoOrcamento[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ITENS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        ordenacao: [['id_item', 'asc']],
      },
      OPERACOES_DE_ORCAMENTOS.LISTAR_ITENS,
    );
    return linhas.map((linha) => validarLinha(esquemaDoItem, linha, TABELA_DE_ITENS));
  }

  /** Grava um item novo e devolve o identificador. */
  async inserirItem(idOrcamento: number, item: ItemAInserir): Promise<number> {
    const resposta = await this.proxy.executar<{ dados: unknown[] }>(
      'dados.inserir',
      {
        tabela: TABELA_DE_ITENS,
        valores: {
          id_orcamento: idOrcamento,
          id_variacao: item.idVariacao,
          granularidade: item.granularidade,
          id_fardo: item.idFardo,
          quantidade_fardos: item.quantidadeFardos,
          id_faixa_preco: item.idFaixaPreco,
          quantidade_avulsa: item.quantidadeAvulsa,
          preco_unitario_aplicado: centavosParaDecimal(item.precoUnitarioAplicado),
          valor_imposto: centavosParaDecimal(item.valorImposto),
          valor_total_item: centavosParaDecimal(item.valorTotalItem),
          aprovacao_herdada: item.aprovacaoHerdada,
        },
        retornar: ['id_item'],
      },
      OPERACOES_DE_ORCAMENTOS.INSERIR_ITEM,
    );
    const [linha] = resposta.dados;
    return validarLinha(z.object({ idItem: z.number().int() }), linha, TABELA_DE_ITENS).idItem;
  }

  /** Atualiza a quantidade e o recálculo de um item já gravado (UC16). */
  async atualizarItem(
    idItem: number,
    dados: Pick<
      ItemAInserir,
      | 'quantidadeFardos'
      | 'quantidadeAvulsa'
      | 'idFaixaPreco'
      | 'precoUnitarioAplicado'
      | 'valorImposto'
      | 'valorTotalItem'
    >,
  ): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_ITENS,
        filtros: { e: [['id_item', '=', idItem]] },
        valores: {
          quantidade_fardos: dados.quantidadeFardos,
          quantidade_avulsa: dados.quantidadeAvulsa,
          id_faixa_preco: dados.idFaixaPreco,
          preco_unitario_aplicado: centavosParaDecimal(dados.precoUnitarioAplicado),
          valor_imposto: centavosParaDecimal(dados.valorImposto),
          valor_total_item: centavosParaDecimal(dados.valorTotalItem),
        },
      },
      OPERACOES_DE_ORCAMENTOS.ATUALIZAR_ITEM,
    );
  }

  /** Remove um item do orçamento. */
  async removerItem(idItem: number): Promise<void> {
    await this.proxy.executar(
      'dados.excluir',
      { tabela: TABELA_DE_ITENS, filtros: { e: [['id_item', '=', idItem]] } },
      OPERACOES_DE_ORCAMENTOS.REMOVER_ITEM,
    );
  }

  /** Grava os totais recalculados do orçamento depois de uma mudança nos itens. */
  async atualizarTotais(
    idOrcamento: number,
    totais: TotaisDoOrcamento,
    agora: Date,
  ): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        valores: {
          valor_total_itens: valoresDecimais(totais.valorTotalItens),
          valor_total_imposto: valoresDecimais(totais.valorTotalImposto),
          valor_total_proposta: valoresDecimais(totais.valorTotalProposta),
          data_ultima_edicao: agora.toISOString(),
        },
      },
      OPERACOES_DE_ORCAMENTOS.ATUALIZAR_CONDICOES,
    );
  }

  /** Grava as mudanças de cabeçalho (UC14). */
  async atualizarCabecalho(
    idOrcamento: number,
    dados: AlteracaoDeCabecalho,
    agora: Date,
  ): Promise<void> {
    const valores: Record<string, unknown> = { data_ultima_edicao: agora.toISOString() };
    if ('numeroSolicitacaoCompra' in dados)
      valores.numero_solicitacao_compra = dados.numeroSolicitacaoCompra;
    if ('contatoSolicitacao' in dados) valores.contato_solicitacao = dados.contatoSolicitacao;
    if ('idEnderecoEntrega' in dados) valores.id_endereco_entrega = dados.idEnderecoEntrega;
    if ('prazoEntregaDias' in dados) valores.prazo_entrega_dias = dados.prazoEntregaDias;
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        valores,
      },
      OPERACOES_DE_ORCAMENTOS.ATUALIZAR_CABECALHO,
    );
  }

  /** Grava as condições comerciais recalculadas (UC18). */
  async atualizarCondicoes(
    idOrcamento: number,
    dados: AlteracaoDeCondicoes,
    agora: Date,
  ): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        valores: {
          condicao_pagamento: dados.condicaoPagamento,
          prazo_dias: dados.prazoDias,
          numero_parcelas: dados.numeroParcelas,
          modalidade_frete: dados.modalidadeFrete,
          origem_transportadora: dados.origemTransportadora,
          transportadora: dados.transportadora,
          valor_frete: valoresDecimais(dados.valorFrete),
          frete_provisorio: dados.freteProvisorio,
          valor_total_proposta: valoresDecimais(dados.valorTotalProposta),
          data_ultima_edicao: agora.toISOString(),
        },
      },
      OPERACOES_DE_ORCAMENTOS.ATUALIZAR_CONDICOES,
    );
  }

  /**
   * Emite o orçamento (`orcamento.emitir`): confere estoque, atribui o número sequencial e a
   * chave de segurança, grava as reservas e aprova o pedido de origem, tudo atomicamente.
   *
   * @param gerarChave Gera uma chave de segurança nova a cada tentativa, para a rara colisão.
   * @throws {ErroDeOrcamentoNaoEncontrado} Se o orçamento não existir (404).
   * @throws {ErroDeOrcamentoNaoEditavel} Se o status não permitir emissão (422).
   * @throws {ErroDeEstoqueInsuficiente} Se algum item não tiver saldo suficiente (409, UC19-E5).
   */
  async emitir(
    idOrcamento: number,
    idOperador: number,
    gerarChave: () => string,
  ): Promise<EmissaoDoOrcamento> {
    const TENTATIVAS_MAXIMAS = 3;
    for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS; tentativa += 1) {
      try {
        const resposta = await this.proxy.executar<{ dados: unknown }>(
          'orcamento.emitir',
          { id_orcamento: idOrcamento, id_operador: idOperador, chave_seguranca: gerarChave() },
          OPERACOES_DE_ORCAMENTOS.EMITIR,
        );
        return validarLinha(esquemaDaEmissao, resposta.dados, 'orcamento.emitir');
      } catch (erro) {
        if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.CHAVE_DUPLICADA) {
          continue;
        }
        if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.NOT_FOUND) {
          throw new ErroDeOrcamentoNaoEncontrado();
        }
        if (erro instanceof ErroProxy && erro.codigo === CODIGOS_DO_PROXY.ESTOQUE_INSUFICIENTE) {
          // Rede de segurança contra uma corrida: a verificação de bloqueios antes de chamar
          // `orcamento.emitir` já deveria ter detectado o saldo insuficiente (UC19-E5).
          throw new ErroDeEstoqueInsuficiente(
            'O saldo de um ou mais itens mudou e não é mais suficiente para a emissão.',
            {},
          );
        }
        throw erro;
      }
    }
    throw new ErroProxy(
      409,
      CODIGOS_DO_PROXY.CHAVE_DUPLICADA,
      'colisões repetidas na chave de segurança',
    );
  }

  /** Cancela o orçamento, com a justificativa opcional. */
  async cancelar(idOrcamento: number, agora: Date): Promise<void> {
    await this.proxy.executar(
      'dados.atualizar',
      {
        tabela: TABELA_DE_ORCAMENTOS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        valores: { status: 'CANCELADO', data_encerramento: agora.toISOString() },
      },
      OPERACOES_DE_ORCAMENTOS.CANCELAR,
    );
  }

  /** Histórico do orçamento, do mais antigo para o mais recente. */
  async listarHistorico(idOrcamento: number): Promise<EventoDoHistorico[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_HISTORICO,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        ordenacao: [['id_historico', 'asc']],
      },
      OPERACOES_DE_ORCAMENTOS.LISTAR_HISTORICO,
    );
    return linhas.map((linha) => validarLinha(esquemaDoHistorico, linha, TABELA_DE_HISTORICO));
  }

  /** Registra um evento no histórico (mudança de status ou follow-up). */
  async registrarHistorico(evento: {
    idOrcamento: number;
    idOperador: number | null;
    tipoEvento: (typeof TIPOS_DE_EVENTO_HISTORICO)[number];
    statusAnterior: StatusDoOrcamento | null;
    statusNovo: StatusDoOrcamento;
    observacao: string | null;
  }): Promise<void> {
    await this.proxy.executar(
      'dados.inserir',
      {
        tabela: TABELA_DE_HISTORICO,
        valores: {
          id_orcamento: evento.idOrcamento,
          id_operador: evento.idOperador,
          tipo_evento: evento.tipoEvento,
          status_anterior: evento.statusAnterior,
          status_novo: evento.statusNovo,
          observacao: evento.observacao,
        },
      },
      OPERACOES_DE_ORCAMENTOS.REGISTRAR_HISTORICO,
    );
  }

  /** Anexos do orçamento (UC19). */
  async listarAnexos(idOrcamento: number): Promise<AnexoDoOrcamento[]> {
    const linhas = await consultarTodas(
      this.proxy,
      {
        tabela: TABELA_DE_ANEXOS,
        filtros: { e: [['id_orcamento', '=', idOrcamento]] },
        ordenacao: [['id_anexo', 'asc']],
      },
      OPERACOES_DE_ORCAMENTOS.LISTAR_ANEXOS,
    );
    return linhas.map((linha) => validarLinha(esquemaDoAnexo, linha, TABELA_DE_ANEXOS));
  }

  /** Cadeia de versões do orçamento: a origem e cada substituição, da mais antiga à atual. */
  async listarVersoes(orcamento: Orcamento): Promise<Orcamento[]> {
    const versoes: Orcamento[] = [orcamento];
    let atual = orcamento;
    while (atual.idOrcamentoOrigem !== null) {
      const origem = await this.buscarPorId(atual.idOrcamentoOrigem);
      if (!origem) {
        break;
      }
      versoes.unshift(origem);
      atual = origem;
    }
    return versoes;
  }
}
