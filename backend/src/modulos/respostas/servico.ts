// UC20, UC21 — processamento automático da resposta do cliente e tratamento pelo operador.
//
// UC20 (`processarPendentes`) é o lado automático: para cada resposta PENDENTE, recalcula o
// fechamento por item com `recalcularOrcamentoAprovado` (services/calculo/fechamento.ts) e grava
// o resultado com a operação nomeada `resposta.processar` (docs/12, seção 12.8.3). Essa operação
// já baixa (BAIXADA) as reservas dos itens aprovados e libera as demais quando o orçamento vai
// para ACEITO; mas na recusa e no pedido de alteração (RECUSADO/ALTERACAO_SOLICITADA) ela só muda
// o status — a liberação das reservas do orçamento inteiro (UC20, passo 2) é uma chamada separada
// deste serviço, pelo mesmo `RepositorioDeOrcamentos.liberarReservas` que `ServicoDeOrcamentos.
// cancelar` usa. Quem dispara esta rotina periodicamente (job agendado ou chamada manual) é
// decidido no item 9 do TAREFAS.md; aqui só fica pronta para ser chamada.
//
// UC21 é a tela do operador: lista as respostas que pararam em AGUARDA_OPERADOR, cria (ou
// reabre) o rascunho de uma nova versão a partir de uma delas e, na emissão, substitui o
// orçamento original. A criação/emissão da nova versão é delegada a `GestorDeVersoesDeOrcamento`
// — a interface fica aqui (quem consome) para `respostas` não importar `orcamentos` em tempo de
// import; `ServicoDeOrcamentos` a implementa e é injetada só na montagem do app
// (`http/app.ts`), no mesmo padrão de `MontadorDeOrcamentos` (pedidos → orçamentos).
import {
  recalcularOrcamentoAprovado,
  type FaixaPreco,
  type Granularidade,
  type ItemOrcamentoAprovado,
  type ItemRecalculado,
} from '../cotacao/calculoAdapter';
import { ErroDeOrcamentoNaoEncontrado, ErroDeRespostaJaTratada } from '../../erros';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import type { RepositorioDeClientes } from '../clientes/repositorio';
import type {
  ItemDoOrcamento,
  Orcamento,
  RepositorioDeOrcamentos,
  StatusDoOrcamento,
} from '../orcamentos/repositorio';
import type { RepositorioDeProdutos, VariacaoDeProduto } from '../produtos/repositorio';
import type { RepositorioDeUsuarios } from '../usuarios/repositorio';
import {
  RepositorioDeRespostas,
  type FiltroDeRespostasPendentes,
  type ItemDaResposta,
  type MotivoDeTratamento,
  type ResultadoDoProcessamento,
  type RespostaDoOrcamento,
  type SituacaoDoItem,
} from './repositorio';

const STATUS_RESPOSTA_AGUARDA_OPERADOR = 'AGUARDA_OPERADOR';
const STATUS_ORCAMENTO_ACEITO = 'ACEITO';

/** Item ainda não gravado, para `criarNovaVersao` — mesmo formato de `ItemAInserir` (orçamentos). */
export interface ItemParaNovaVersao {
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

/**
 * Ciclo de vida de uma nova versão de orçamento (UC21), implementado por `ServicoDeOrcamentos` e
 * injetado aqui só na montagem do app — ver o comentário no topo deste arquivo.
 */
export interface GestorDeVersoesDeOrcamento {
  /** Detalhe completo do orçamento (o mesmo de `GET /orcamentos/:id`), para `novaVersao`. */
  obter(idOrcamento: number): Promise<object>;
  /**
   * Cria o rascunho da nova versão, ou devolve o id do já existente para este orçamento origem.
   *
   * @throws Se a origem não permitir nova versão (ABERTO ou ALTERACAO_SOLICITADA exigidos).
   */
  criarNovaVersao(
    idOrcamentoOrigem: number,
    itens: readonly ItemParaNovaVersao[],
    autor: Sessao,
  ): Promise<number>;
  /**
   * Emite a nova versão e substitui o original (SUBSTITUIDO, reservas liberadas). Tipado só pelo
   * campo que a rota HTTP devolve (`{idOrcamento}`, docs/frontend-api.md linha 48); quem chama
   * não precisa do formato completo de `OrcamentoDetalhado`.
   */
  emitirNovaVersao(idOrcamentoNovo: number, autor: Sessao): Promise<{ idOrcamento: number }>;
  /** Descarta o rascunho (reaproveita o cancelamento comum de orçamento, UC06). */
  cancelar(idOrcamento: number, justificativa: string | null, autor: Sessao): Promise<void>;
}

/** Linha da lista de respostas pendentes de tratamento (UC21). É `RespostaPendenteResumo`. */
export interface RespostaPendenteResumo {
  readonly idResposta: number;
  readonly idOrcamento: number;
  readonly numeroOrcamento: number | null;
  readonly cliente: string;
  readonly vendedor: string;
  /** O que o frontend chama de `TipoRespostaPendente`: na prática o `motivoTratamento`. */
  readonly tipo: MotivoDeTratamento;
  readonly dataResposta: string;
}

/** Um item do orçamento respondido, cotado × aprovado (UC21). É `ItemRespostaDetalhe`. */
export interface ItemRespostaDetalhado {
  readonly idItem: number;
  readonly produto: string;
  readonly situacao: SituacaoDoItem;
  readonly quantidadeCotada: number;
  readonly quantidadeAprovada: number;
  readonly valorTotalItemAceito: number | null;
}

/** Detalhe da resposta para a tela de tratamento (UC21). É `RespostaPendenteDetalhe`. */
export interface RespostaPendenteDetalhada extends RespostaPendenteResumo {
  readonly justificativa: string | null;
  readonly itensOriginal: readonly ItemRespostaDetalhado[];
  readonly valorTotalAceito: number | null;
  readonly novaVersao: object;
}

export interface DependenciasDoServicoDeRespostas {
  readonly respostas: RepositorioDeRespostas;
  readonly orcamentos: RepositorioDeOrcamentos;
  readonly produtos: RepositorioDeProdutos;
  readonly clientes: RepositorioDeClientes;
  readonly usuarios: RepositorioDeUsuarios;
  readonly gestorDeVersoes: GestorDeVersoesDeOrcamento;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Regras do processamento da resposta do cliente (UC20) e do tratamento pelo operador (UC21). */
export class ServicoDeRespostas {
  private readonly respostas: RepositorioDeRespostas;
  private readonly orcamentos: RepositorioDeOrcamentos;
  private readonly produtos: RepositorioDeProdutos;
  private readonly clientes: RepositorioDeClientes;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly gestorDeVersoes: GestorDeVersoesDeOrcamento;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeRespostas) {
    this.respostas = dependencias.respostas;
    this.orcamentos = dependencias.orcamentos;
    this.produtos = dependencias.produtos;
    this.clientes = dependencias.clientes;
    this.usuarios = dependencias.usuarios;
    this.gestorDeVersoes = dependencias.gestorDeVersoes;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  // ------------------------------------------------------------------------------------------
  // UC20 — processamento automático

  /**
   * Processa todas as respostas PENDENTE. Cada resposta é independente: uma falha não impede o
   * processamento das demais (fica PENDENTE para a próxima rodada).
   *
   * @returns Quantas respostas foram processadas com sucesso.
   */
  async processarPendentes(): Promise<number> {
    const pendentes = await this.respostas.listarPendentes();
    let processadas = 0;
    for (const resposta of pendentes) {
      try {
        await this.processarUma(resposta);
        processadas += 1;
      } catch (erro) {
        this.logger.error({
          evento: 'resposta_processamento_falhou',
          idResposta: resposta.idResposta,
          erro,
        });
      }
    }
    return processadas;
  }

  /** Processa uma única resposta (UC20, fluxo principal). */
  private async processarUma(resposta: RespostaDoOrcamento): Promise<void> {
    const orcamento = await this.orcamentos.buscarPorId(resposta.idOrcamento);
    if (!orcamento) {
      throw new ErroDeOrcamentoNaoEncontrado();
    }
    const resultado = await this.montarResultado(resposta, orcamento);
    await this.respostas.processar(resposta.idResposta, resultado);
    if (
      resultado.statusOrcamento === 'RECUSADO' ||
      resultado.statusOrcamento === 'ALTERACAO_SOLICITADA'
    ) {
      // `resposta.processar` só libera reservas no ramo ACEITO (docs/12, seção 12.8.3); aqui o
      // orçamento inteiro deixa de valer, então todas as suas reservas são liberadas (UC20,
      // passo 2), como `ServicoDeOrcamentos.cancelar` já faz para o cancelamento manual (UC06).
      await this.orcamentos.liberarReservas(orcamento.idOrcamento);
    }
    if (resultado.statusOrcamento !== orcamento.status) {
      await this.orcamentos.registrarHistorico({
        idOrcamento: orcamento.idOrcamento,
        idOperador: null,
        tipoEvento: 'MUDANCA_STATUS',
        statusAnterior: orcamento.status,
        statusNovo: resultado.statusOrcamento as StatusDoOrcamento,
        observacao: null,
      });
    }
    this.logger.info({
      evento: 'resposta_processada',
      idResposta: resposta.idResposta,
      idOrcamento: orcamento.idOrcamento,
      statusResposta: resultado.statusResposta,
      statusOrcamento: resultado.statusOrcamento,
    });
  }

  /** Monta o payload de `resposta.processar` a partir do tipo da resposta (UC20, passos 2-7). */
  private async montarResultado(
    resposta: RespostaDoOrcamento,
    orcamento: Orcamento,
  ): Promise<ResultadoDoProcessamento> {
    if (resposta.tipoResposta === 'RECUSA') {
      return {
        statusResposta: STATUS_RESPOSTA_AGUARDA_OPERADOR,
        motivoTratamento: 'RECUSA',
        itens: [],
        totais: null,
        statusOrcamento: 'RECUSADO',
      };
    }
    if (resposta.tipoResposta === 'ALTERACAO') {
      return {
        statusResposta: STATUS_RESPOSTA_AGUARDA_OPERADOR,
        motivoTratamento: 'ALTERACAO',
        itens: [],
        totais: null,
        statusOrcamento: 'ALTERACAO_SOLICITADA',
      };
    }
    // tipoResposta === 'ITENS': aprovação por item (UC20, passos 3-7).
    const itensDaResposta = await this.respostas.listarItens(resposta.idResposta);
    const itensDoOrcamento = await this.orcamentos.listarItens(orcamento.idOrcamento);
    const entrada = await this.montarEntradaDeFechamento(itensDoOrcamento, itensDaResposta);
    const resultado = recalcularOrcamentoAprovado({
      itens: entrada,
      primeiraCompra: orcamento.primeiraCompra,
      origemTransportadora: orcamento.origemTransportadora ?? undefined,
      valorFreteCotado: orcamento.valorFrete,
    });
    const itens = this.paraItensDoResultado(resultado.itens, itensDaResposta);
    if (!resultado.todosAprovados) {
      return {
        statusResposta: STATUS_RESPOSTA_AGUARDA_OPERADOR,
        motivoTratamento: 'ITENS_NAO_APROVADOS',
        itens,
        totais: null,
        statusOrcamento: orcamento.status,
      };
    }
    if (resultado.fechamento === null || !resultado.fechamento.ok) {
      return {
        statusResposta: STATUS_RESPOSTA_AGUARDA_OPERADOR,
        motivoTratamento: 'ABAIXO_DO_MINIMO',
        itens,
        totais: null,
        statusOrcamento: orcamento.status,
      };
    }
    const { frete, valorTotalAceito } = resultado.fechamento;
    return {
      statusResposta: 'CONSOLIDADA',
      motivoTratamento: null,
      itens,
      totais: {
        valorTotalItensAprovado: resultado.valorTotalItensAprovado,
        valorTotalImpostoAprovado: resultado.valorTotalImpostoAprovado,
        modalidadeFreteAceita: frete.modalidade,
        valorFreteAceito: frete.modalidade === 'FOB' ? frete.valorFrete : null,
        valorTotalAceito,
      },
      statusOrcamento: STATUS_ORCAMENTO_ACEITO,
    };
  }

  /** Monta a entrada de `recalcularOrcamentoAprovado` a partir dos itens do orçamento e da resposta. */
  private async montarEntradaDeFechamento(
    itensDoOrcamento: readonly ItemDoOrcamento[],
    itensDaResposta: readonly ItemDaResposta[],
  ): Promise<ItemOrcamentoAprovado[]> {
    const aprovacaoPorItem = new Map(
      itensDaResposta.map((item) => [item.idItem, item.quantidadeAprovada]),
    );
    const idsDasVariacoes = [...new Set(itensDoOrcamento.map((item) => item.idVariacao))];
    const variacoes = await Promise.all(
      idsDasVariacoes.map((idVariacao) => this.produtos.buscarVariacaoComPrecos(idVariacao)),
    );
    const variacaoPorId = new Map(
      variacoes
        .filter((variacao): variacao is VariacaoDeProduto => variacao !== null)
        .map((variacao, indice) => [idsDasVariacoes[indice] as number, variacao]),
    );
    return itensDoOrcamento.map((item) => {
      const variacao = variacaoPorId.get(item.idVariacao);
      const quantidadeCotada =
        item.granularidade === 'FARDO'
          ? (item.quantidadeFardos ?? 0)
          : (item.quantidadeAvulsa ?? 0);
      // Item sem resposta registrada nesta rodada não é aprovado (RN; cada resposta nova parte do
      // estado anterior, mas o vendedor sempre responde todos os itens de uma vez, UC11).
      const quantidadeAprovada = aprovacaoPorItem.get(item.idItem) ?? 0;
      if (item.granularidade === 'FARDO') {
        const fardo = variacao?.fardos.find((candidato) => candidato.idFardo === item.idFardo);
        return {
          idItem: item.idItem,
          granularidade: 'FARDO',
          quantidadeCotada,
          quantidadeAprovada,
          precoFardo: fardo?.precoFixo ?? item.precoUnitarioAplicado,
        };
      }
      const faixas: FaixaPreco[] = variacao?.faixasPreco.length
        ? [...variacao.faixasPreco]
        : [{ idFaixaPreco: 0, quantidadeMinima: 0, precoUnitario: item.precoUnitarioAplicado }];
      return {
        idItem: item.idItem,
        granularidade: 'AVULSO',
        quantidadeCotada,
        quantidadeAprovada,
        faixas,
      };
    });
  }

  /** Traduz o `ItemRecalculado` (idItem) para o payload de `resposta.processar` (idItemResposta). */
  private paraItensDoResultado(
    recalculados: readonly ItemRecalculado[],
    itensDaResposta: readonly ItemDaResposta[],
  ): ResultadoDoProcessamento['itens'] {
    const idItemRespostaPorIdItem = new Map(
      itensDaResposta.map((item) => [item.idItem, item.idItemResposta]),
    );
    return recalculados
      .filter((item) => idItemRespostaPorIdItem.has(item.idItem))
      .map((item) => ({
        idItemResposta: idItemRespostaPorIdItem.get(item.idItem) as number,
        situacao: item.situacao,
        idFaixaPrecoAceita: item.idFaixaPrecoAceita,
        precoUnitarioAceito: item.precoUnitarioAceito,
        valorImpostoAceito: item.imposto,
        valorTotalItemAceito: item.totalItem,
      }));
  }

  // ------------------------------------------------------------------------------------------
  // UC21 — tratamento pelo operador

  /** Respostas aguardando tratamento, com os filtros da tela (RF27). */
  async listarPendentes(filtro: FiltroDeRespostasPendentes): Promise<RespostaPendenteResumo[]> {
    const pendentes = await this.respostas.listarAguardandoOperador(filtro);
    return this.paraResumos(pendentes);
  }

  /** Quantas respostas aguardam tratamento (contador da tela de notificações). */
  async contarPendentes(): Promise<number> {
    const pendentes = await this.respostas.listarAguardandoOperador({});
    return pendentes.length;
  }

  /**
   * Abre a tela de tratamento (UC21, passos 1-3): cria ou retoma o rascunho da nova versão.
   *
   * @throws {ErroDeRespostaJaTratada} Se a resposta não estiver mais aguardando tratamento (409).
   */
  async obterDetalhe(idResposta: number, autor: Sessao): Promise<RespostaPendenteDetalhada> {
    const resposta = await this.respostas.buscarOuFalhar(idResposta);
    this.exigirAguardandoOperador(resposta);
    const idRascunho = await this.garantirRascunho(resposta, autor);
    const [resumo, novaVersao] = await Promise.all([
      this.paraDetalhe(resposta),
      this.gestorDeVersoes.obter(idRascunho),
    ]);
    return { ...resumo, novaVersao };
  }

  /**
   * Emite a nova versão já reestruturada pelo operador (UC21, passo 5): substitui o original e
   * marca a resposta como tratada.
   *
   * @throws {ErroDeRespostaJaTratada} Se a resposta não estiver mais aguardando tratamento (409).
   */
  async emitirNovaVersao(idResposta: number, autor: Sessao): Promise<{ idOrcamento: number }> {
    const resposta = await this.respostas.buscarOuFalhar(idResposta);
    this.exigirAguardandoOperador(resposta);
    const idRascunho = await this.garantirRascunho(resposta, autor);
    const emitida = await this.gestorDeVersoes.emitirNovaVersao(idRascunho, autor);
    await this.respostas.marcarTratada(idResposta, autor.idOperador, this.agora());
    this.logger.info({
      evento: 'resposta_tratada_com_nova_versao',
      idResposta,
      idOrcamentoNovo: idRascunho,
      idAutor: autor.idOperador,
    });
    return emitida;
  }

  /** Marca a resposta como tratada sem criar nova versão (UC21-A1): descarta um rascunho pendente. */
  async tratarSemNovaVersao(idResposta: number, autor: Sessao): Promise<void> {
    const resposta = await this.respostas.buscarOuFalhar(idResposta);
    this.exigirAguardandoOperador(resposta);
    const rascunho = await this.orcamentos.buscarRascunhoDeVersao(resposta.idOrcamento);
    if (rascunho) {
      await this.gestorDeVersoes.cancelar(rascunho.idOrcamento, null, autor);
    }
    await this.respostas.marcarTratada(idResposta, autor.idOperador, this.agora());
    this.logger.info({
      evento: 'resposta_tratada_sem_nova_versao',
      idResposta,
      idAutor: autor.idOperador,
    });
  }

  /** Descarta o rascunho da nova versão (UC21-A2): a resposta continua aguardando tratamento. */
  async descartarRascunho(idResposta: number, autor: Sessao): Promise<void> {
    const resposta = await this.respostas.buscarOuFalhar(idResposta);
    this.exigirAguardandoOperador(resposta);
    const rascunho = await this.orcamentos.buscarRascunhoDeVersao(resposta.idOrcamento);
    if (rascunho) {
      await this.gestorDeVersoes.cancelar(rascunho.idOrcamento, null, autor);
    }
    this.logger.info({
      evento: 'rascunho_de_versao_descartado',
      idResposta,
      idAutor: autor.idOperador,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Internos

  private exigirAguardandoOperador(resposta: RespostaDoOrcamento): void {
    if (resposta.statusResposta !== STATUS_RESPOSTA_AGUARDA_OPERADOR) {
      throw new ErroDeRespostaJaTratada();
    }
  }

  /** Cria o rascunho da nova versão se ainda não existir um para este orçamento (idempotente). */
  private async garantirRascunho(resposta: RespostaDoOrcamento, autor: Sessao): Promise<number> {
    const [itensDoOrcamento, itensDaResposta] = await Promise.all([
      this.orcamentos.listarItens(resposta.idOrcamento),
      this.respostas.listarItens(resposta.idResposta),
    ]);
    const aprovadosPorItem = new Map(
      itensDaResposta.map((item) => [item.idItem, item.situacao === 'APROVADO']),
    );
    const itensParaNovaVersao: ItemParaNovaVersao[] = itensDoOrcamento.map((item) => ({
      idVariacao: item.idVariacao,
      granularidade: item.granularidade,
      idFardo: item.idFardo,
      quantidadeFardos: item.quantidadeFardos,
      idFaixaPreco: item.idFaixaPreco,
      quantidadeAvulsa: item.quantidadeAvulsa,
      precoUnitarioAplicado: item.precoUnitarioAplicado,
      valorImposto: item.valorImposto,
      valorTotalItem: item.valorTotalItem,
      aprovacaoHerdada: aprovadosPorItem.get(item.idItem) ?? false,
    }));
    return this.gestorDeVersoes.criarNovaVersao(resposta.idOrcamento, itensParaNovaVersao, autor);
  }

  private async paraDetalhe(
    resposta: RespostaDoOrcamento,
  ): Promise<Omit<RespostaPendenteDetalhada, 'novaVersao'>> {
    const [resumo, itensDaResposta, itensDoOrcamento] = await Promise.all([
      this.paraResumo(resposta),
      this.respostas.listarItens(resposta.idResposta),
      this.orcamentos.listarItens(resposta.idOrcamento),
    ]);
    const itensOriginal = await this.detalharItensDaResposta(itensDoOrcamento, itensDaResposta);
    return {
      ...resumo,
      justificativa: resposta.justificativa,
      itensOriginal,
      valorTotalAceito: resposta.valorTotalAceito,
    };
  }

  private async detalharItensDaResposta(
    itensDoOrcamento: readonly ItemDoOrcamento[],
    itensDaResposta: readonly ItemDaResposta[],
  ): Promise<ItemRespostaDetalhado[]> {
    const idsDasVariacoes = [...new Set(itensDoOrcamento.map((item) => item.idVariacao))];
    const variacoes = await this.produtos.buscarVariacoesPorId(idsDasVariacoes);
    const produtoPorVariacao = new Map(
      variacoes.map((variacao) => [variacao.idVariacao, variacao.descricaoDoProduto]),
    );
    const respostaPorItem = new Map(itensDaResposta.map((item) => [item.idItem, item]));
    return itensDoOrcamento.map((item) => {
      const itemResposta = respostaPorItem.get(item.idItem);
      const quantidadeCotada =
        item.granularidade === 'FARDO'
          ? (item.quantidadeFardos ?? 0)
          : (item.quantidadeAvulsa ?? 0);
      return {
        idItem: item.idItem,
        produto: produtoPorVariacao.get(item.idVariacao) ?? '',
        situacao: itemResposta?.situacao ?? (item.aprovacaoHerdada ? 'APROVADO' : 'NAO_APROVADO'),
        quantidadeCotada,
        quantidadeAprovada: itemResposta?.quantidadeAprovada ?? 0,
        valorTotalItemAceito: itemResposta?.valorTotalItemAceito ?? null,
      };
    });
  }

  private async paraResumos(
    respostas: readonly RespostaDoOrcamento[],
  ): Promise<RespostaPendenteResumo[]> {
    return Promise.all(respostas.map((resposta) => this.paraResumo(resposta)));
  }

  private async paraResumo(resposta: RespostaDoOrcamento): Promise<RespostaPendenteResumo> {
    const [orcamento, vendedor] = await Promise.all([
      this.orcamentos.buscarPorId(resposta.idOrcamento),
      this.usuarios.buscarPorId(resposta.idOperadorVendedor),
    ]);
    const cliente = orcamento ? await this.clientes.buscarPorId(orcamento.idCliente) : null;
    return {
      idResposta: resposta.idResposta,
      idOrcamento: resposta.idOrcamento,
      numeroOrcamento: orcamento?.numeroOrcamento ?? null,
      cliente: cliente?.razaoSocial ?? '',
      vendedor: vendedor?.usuario ?? '',
      // `paraResumo` só é chamado para respostas AGUARDA_OPERADOR, que `montarResultado` sempre
      // grava com `motivoTratamento` preenchido.
      tipo: resposta.motivoTratamento as MotivoDeTratamento,
      dataResposta: resposta.dataResposta,
    };
  }
}
