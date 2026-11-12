// UC01, UC05, UC14-19 — regras do orçamento: rascunho, itens, condições comerciais, emissão e
// cancelamento. Implementa `MontadorDeOrcamentos` para o módulo de pedidos (UC10 → UC14).
import { randomBytes } from 'node:crypto';
import type { ClienteDeProxy } from '../../dados';
import {
  ErroDeEmissaoBloqueada,
  ErroDeEstoqueIndisponivel,
  ErroDeItemNaoEncontrado,
  ErroDeNovaVersaoNaoPermitida,
  ErroDeOrcamentoNaoEditavel,
  ErroDeOrcamentoNaoEncontrado,
  ErroDeValidacao,
  ErroDeVariacaoNaoEncontrada,
} from '../../erros';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import type { RepositorioDeClientes } from '../clientes/repositorio';
import type {
  HistoricoDeCompraDoCliente,
  LeitorDeOrcamentosDoCliente,
  OrcamentoEmAbertoDoCliente,
} from '../clientes/servico';
import { calcularSaldoDisponivel, somarReservasPorVariacao } from '../comum/estoque';
import { obterSituacaoCliente } from '../comum/situacaoCliente';
import {
  calcularFrete,
  calcularLinhaDoItem,
  hojeComoDataISO,
  validarCondicaoFaturamento,
  validarDisponibilidadeEstoque,
  type ResultadoFaturamento,
} from '../cotacao/calculoAdapter';
import type { ItemDePedido, Pedido } from '../pedidos/repositorio';
import type { MontadorDeOrcamentos } from '../pedidos/servico';
import type { RepositorioDeProdutos, VariacaoDeProduto } from '../produtos/repositorio';
import type { GestorDeVersoesDeOrcamento, ItemParaNovaVersao } from '../respostas/servico';
import type { RepositorioDeUsuarios } from '../usuarios/repositorio';
import {
  RepositorioDeOrcamentos,
  STATUS_DO_ORCAMENTO_EDITAVEIS,
  STATUS_DO_ORCAMENTO_EM_ABERTO,
  type AlteracaoDeCabecalho,
  type EventoDoHistorico,
  type ItemAInserir,
  type ItemDoOrcamento,
  type Orcamento,
  type StatusDoOrcamento,
} from './repositorio';
import type {
  DadosDasCondicoesAtualizar,
  DadosDoCabecalhoAtualizar,
  DadosDoItemAdicionar,
  DadosDoOrcamentoNovo,
} from './esquemas';

const OPERACAO_SITUACAO_CLIENTE = 'UC14-situacao-cliente';
const OPERACAO_SALDO_ITEM = 'UC15-saldo-item';
const BYTES_DA_CHAVE_DE_SEGURANCA = 24;
/** Valor abaixo do qual um resultado de crédito reprovado não bloqueia (50% adiantado cobre). */
const STATUS_PENDENTE_CREDITO: StatusDoOrcamento = 'PENDENTE_CREDITO';
/** Compra fechada (RF04, RF17): orçamento com todos os itens aprovados pelo cliente. */
const STATUS_ACEITO: StatusDoOrcamento = 'ACEITO';
/** Emitido, com reservas CONFIRMADA vigentes (docs/04, seção 4.6). */
const STATUS_ABERTO: StatusDoOrcamento = 'ABERTO';
/** Status que o operador pode cancelar diretamente (UC06; docs/04, seção 4.6). */
const STATUS_DO_ORCAMENTO_CANCELAVEIS: ReadonlySet<StatusDoOrcamento> = new Set([
  'RASCUNHO',
  'PENDENTE_CREDITO',
  STATUS_ABERTO,
]);
/** Status da origem que permitem criar uma nova versão (UC21-E1, RF21). */
const STATUS_DO_ORCAMENTO_PERMITEM_NOVA_VERSAO: ReadonlySet<StatusDoOrcamento> = new Set([
  STATUS_ABERTO,
  'ALTERACAO_SOLICITADA',
]);

export interface BloqueioDeEmissao {
  readonly codigo:
    | 'ABAIXO_DO_MINIMO'
    | 'PENDENTE_CREDITO'
    | 'DIVIDA_EM_ABERTO'
    | 'ESTOQUE_INSUFICIENTE'
    | 'CLIENTE_BLOQUEADO'
    | 'SEM_ITENS';
  readonly mensagem: string;
}

/** Condições comerciais calculadas (sempre ao vivo: nunca confiar só no que está salvo). */
export interface CondicoesComerciais {
  readonly valorTotalItens: number;
  readonly valorTotalImposto: number;
  readonly modalidadeFrete: string | null;
  readonly origemTransportadora: string | null;
  readonly transportadora: string | null;
  readonly valorFrete: number | null;
  readonly freteProvisorio: boolean;
  readonly condicaoPagamento: string | null;
  readonly condicoesPagamentoPermitidas: readonly string[];
  readonly prazoDias: number | null;
  readonly numeroParcelas: number | null;
  readonly valorTotalProposta: number;
  readonly creditoStatus: 'NAO_EXIGIDO' | 'PENDENTE' | 'APROVADO' | 'REPROVADO';
  readonly bloqueios: readonly BloqueioDeEmissao[];
}

/** Um evento do histórico de mudanças do orçamento (UC06). */
export interface EventoDeHistoricoDetalhado {
  readonly tipoEvento: 'MUDANCA_STATUS' | 'ATUALIZACAO_FOLLOWUP';
  readonly statusAnterior: StatusDoOrcamento | null;
  readonly statusNovo: StatusDoOrcamento;
  readonly observacao: string | null;
  readonly usuario: string | null;
  readonly dataRegistro: string;
}

/** Um endereço do cliente, candidato a endereço de entrega. */
export interface EnderecoDetalhado {
  readonly idEndereco: number;
  readonly tipo: string;
  readonly logradouro: string;
  readonly numero: string;
  readonly complemento: string | null;
  readonly bairro: string;
  readonly cidade: string;
  readonly uf: string;
  readonly cep: string;
}

/** Uma versão anterior do orçamento, na cadeia de `idOrcamentoOrigem` (UC06). */
export interface VersaoDetalhada {
  readonly idOrcamento: number;
  readonly numeroOrcamento: number | null;
  readonly status: StatusDoOrcamento;
}

export interface ItemDetalhado {
  readonly idItem: number;
  readonly idVariacao: number;
  readonly produto: string;
  readonly marca: string;
  readonly embalagem: string;
  readonly granularidade: 'FARDO' | 'AVULSO';
  readonly quantidade: number;
  readonly precoUnitarioAplicado: number;
  readonly valorLinha: number;
  readonly valorImposto: number;
  readonly valorTotalItem: number;
  readonly aprovacaoHerdada: boolean;
}

export interface OrcamentoResumido {
  readonly idOrcamento: number;
  readonly numeroOrcamento: number | null;
  readonly idCliente: number;
  readonly cliente: string;
  readonly cnpj: string;
  readonly dataEmissao: string | null;
  readonly dataValidade: string | null;
  readonly diasParaVencer: number | null;
  readonly valorTotalProposta: number | null;
  readonly status: StatusDoOrcamento;
}

export interface OrcamentoDetalhado extends OrcamentoResumido {
  readonly idPedido: number | null;
  readonly numeroPedido: string | null;
  readonly chaveSeguranca: string | null;
  readonly numeroSolicitacaoCompra: string | null;
  readonly contato: string | null;
  readonly idEnderecoEntrega: number | null;
  readonly prazoEntregaDias: number | null;
  readonly enderecosEntrega: readonly EnderecoDetalhado[];
  readonly itens: readonly ItemDetalhado[];
  readonly anexos: readonly never[];
  readonly condicoes: CondicoesComerciais;
  readonly historico: readonly EventoDeHistoricoDetalhado[];
  readonly versoes: readonly VersaoDetalhada[];
}

export interface DependenciasDoServicoDeOrcamentos {
  readonly orcamentos: RepositorioDeOrcamentos;
  readonly clientes: RepositorioDeClientes;
  readonly produtos: RepositorioDeProdutos;
  readonly usuarios: RepositorioDeUsuarios;
  readonly proxy: ClienteDeProxy;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Regras do orçamento (UC01, UC05, UC14-19). */
export class ServicoDeOrcamentos
  implements MontadorDeOrcamentos, LeitorDeOrcamentosDoCliente, GestorDeVersoesDeOrcamento
{
  private readonly orcamentos: RepositorioDeOrcamentos;
  private readonly clientes: RepositorioDeClientes;
  private readonly produtos: RepositorioDeProdutos;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly proxy: ClienteDeProxy;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeOrcamentos) {
    this.orcamentos = dependencias.orcamentos;
    this.clientes = dependencias.clientes;
    this.produtos = dependencias.produtos;
    this.usuarios = dependencias.usuarios;
    this.proxy = dependencias.proxy;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /** Cria o orçamento do zero (UC14, sem pedido de origem). */
  async criar(dados: DadosDoOrcamentoNovo, autor: Sessao): Promise<OrcamentoDetalhado> {
    const primeiraCompra = await this.ehPrimeiraCompra(dados.idCliente);
    const idOrcamento = await this.orcamentos.criar(
      {
        idCliente: dados.idCliente,
        idOperador: autor.idOperador,
        idEnderecoEntrega: dados.idEnderecoEntrega ?? null,
        idPedido: null,
        idOrcamentoOrigem: null,
        numeroSolicitacaoCompra: dados.numeroSolicitacaoCompra ?? null,
        contatoSolicitacao: dados.contatoSolicitacao ?? null,
        prazoEntregaDias: dados.prazoEntregaDias ?? null,
        primeiraCompra,
      },
      this.agora(),
    );
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: null,
      statusNovo: 'RASCUNHO',
      observacao: null,
    });
    return this.obter(idOrcamento);
  }

  /** Cria o orçamento em RASCUNHO a partir de um pedido aprovado (UC10 → UC14). */
  async montarAPartirDoPedido(
    pedido: Pedido,
    itensDoPedido: readonly ItemDePedido[],
    autor: Sessao,
  ): Promise<number> {
    const primeiraCompra = await this.ehPrimeiraCompra(pedido.idCliente);
    const idOrcamento = await this.orcamentos.criar(
      {
        idCliente: pedido.idCliente,
        idOperador: autor.idOperador,
        idEnderecoEntrega: pedido.idEnderecoEntrega,
        idPedido: pedido.idPedido,
        idOrcamentoOrigem: null,
        numeroSolicitacaoCompra: pedido.numeroSolicitacaoCompra,
        contatoSolicitacao: pedido.contatoSolicitacao,
        prazoEntregaDias: null,
        primeiraCompra,
      },
      this.agora(),
    );
    for (const item of itensDoPedido) {
      await this.inserirItemCalculado(idOrcamento, {
        idVariacao: item.idVariacao,
        granularidade: item.granularidade,
        idFardo: item.idFardo,
        quantidade: item.quantidadeSolicitada,
      });
    }
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: null,
      statusNovo: 'RASCUNHO',
      observacao: null,
    });
    return idOrcamento;
  }

  /** Lista os orçamentos que atendem ao filtro (UC01). */
  async listar(filtro: {
    status?: StatusDoOrcamento;
    cliente?: string;
    cnpj?: string;
    numero?: string;
  }): Promise<OrcamentoResumido[]> {
    const orcamentos = await this.orcamentos.listar(
      filtro.status ? { e: [['status', '=', filtro.status]] } : undefined,
    );
    const clientes = await this.mapaDeClientes(orcamentos.map((orcamento) => orcamento.idCliente));
    const filtrados = orcamentos.filter((orcamento) => {
      const cliente = clientes.get(orcamento.idCliente);
      if (
        filtro.cliente &&
        !cliente?.razaoSocial.toLowerCase().includes(filtro.cliente.toLowerCase())
      ) {
        return false;
      }
      if (filtro.cnpj && cliente?.cnpj !== filtro.cnpj) {
        return false;
      }
      if (filtro.numero && String(orcamento.numeroOrcamento ?? '') !== filtro.numero) {
        return false;
      }
      return true;
    });
    return filtrados.map((orcamento) => this.paraResumo(orcamento, clientes));
  }

  /**
   * Orçamentos em aberto do cliente (RF04): ainda em elaboração (RASCUNHO, PENDENTE_CREDITO,
   * ALTERACAO_SOLICITADA) ou emitidos e aguardando o vendedor/cliente (ABERTO). Implementa
   * {@link LeitorDeOrcamentosDoCliente} para o módulo de clientes.
   */
  async listarEmAberto(idCliente: number): Promise<OrcamentoEmAbertoDoCliente[]> {
    const orcamentos = await this.orcamentos.listar({
      e: [
        ['id_cliente', '=', idCliente],
        ['status', 'em', [...STATUS_DO_ORCAMENTO_EM_ABERTO]],
      ],
    });
    const clientes = await this.mapaDeClientes([idCliente]);
    return orcamentos.map((orcamento) => this.paraResumo(orcamento, clientes));
  }

  /**
   * Histórico de compras do cliente (RF04, RF07): orçamentos ACEITO. Implementa
   * {@link LeitorDeOrcamentosDoCliente} para o módulo de clientes.
   */
  async listarHistoricoDeCompras(idCliente: number): Promise<HistoricoDeCompraDoCliente[]> {
    const orcamentos = await this.orcamentos.listar({
      e: [
        ['id_cliente', '=', idCliente],
        ['status', '=', STATUS_ACEITO],
      ],
    });
    return orcamentos
      .filter(
        (orcamento): orcamento is Orcamento & { numeroOrcamento: number; dataEmissao: string } =>
          orcamento.numeroOrcamento !== null && orcamento.dataEmissao !== null,
      )
      .map((orcamento) => ({
        idOrcamento: orcamento.idOrcamento,
        numeroOrcamento: orcamento.numeroOrcamento,
        dataEmissao: orcamento.dataEmissao,
        // TODO item 7: ver o comentário de `ServicoDeClientes.listarHistoricoDeCompras`.
        valorTotalAceito: orcamento.valorTotalProposta ?? 0,
      }));
  }

  /**
   * Detalhe completo do orçamento, com itens e condições comerciais sempre recalculadas.
   *
   * @throws {ErroDeOrcamentoNaoEncontrado} Se o orçamento não existir (404).
   */
  async obter(idOrcamento: number): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    return this.montarDetalhe(orcamento);
  }

  /**
   * Atualiza o cabeçalho do orçamento (UC14).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   */
  async atualizarCabecalho(
    idOrcamento: number,
    dados: DadosDoCabecalhoAtualizar,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    const alteracao: AlteracaoDeCabecalho = {};
    if ('numeroSolicitacaoCompra' in dados)
      Object.assign(alteracao, { numeroSolicitacaoCompra: dados.numeroSolicitacaoCompra });
    if ('contatoSolicitacao' in dados)
      Object.assign(alteracao, { contatoSolicitacao: dados.contatoSolicitacao });
    if ('idEnderecoEntrega' in dados)
      Object.assign(alteracao, { idEnderecoEntrega: dados.idEnderecoEntrega });
    if ('prazoEntregaDias' in dados)
      Object.assign(alteracao, { prazoEntregaDias: dados.prazoEntregaDias });
    await this.orcamentos.atualizarCabecalho(idOrcamento, alteracao, this.agora());
    this.logger.info({
      evento: 'orcamento_cabecalho_atualizado',
      idOrcamento,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * Adiciona um item ao orçamento (UC15).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   * @throws {ErroDeVariacaoNaoEncontrada} Se a variação não existir (404).
   * @throws {ErroDeEstoqueIndisponivel} Se a quantidade exceder o saldo disponível (422, UC17-E1/E2).
   */
  async adicionarItem(
    idOrcamento: number,
    dados: DadosDoItemAdicionar,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    await this.inserirItemCalculado(idOrcamento, {
      idVariacao: dados.idVariacao,
      granularidade: dados.granularidade,
      idFardo: dados.idFardo ?? null,
      quantidade: dados.quantidade,
    });
    this.logger.info({
      evento: 'orcamento_item_adicionado',
      idOrcamento,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * Altera a quantidade de um item (UC16).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   * @throws {ErroDeItemNaoEncontrado} Se o item não existir neste orçamento (404).
   */
  async alterarQuantidade(
    idOrcamento: number,
    idItem: number,
    quantidade: number,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    const item = await this.buscarItemOuFalhar(idOrcamento, idItem);
    const variacao = await this.buscarVariacaoOuFalhar(item.idVariacao);
    await this.verificarEstoque(item.idVariacao, variacao, item.granularidade, quantidade);
    const linha = calcularLinhaDoItem({
      granularidade: item.granularidade,
      quantidade,
      fardo: item.idFardo === null ? undefined : this.fardoEscolhido(variacao, item.idFardo),
      faixas: variacao.faixasPreco,
    });
    await this.orcamentos.atualizarItem(idItem, {
      quantidadeFardos: item.granularidade === 'FARDO' ? quantidade : null,
      quantidadeAvulsa: item.granularidade === 'AVULSO' ? quantidade : null,
      idFaixaPreco: linha.idFaixaPreco,
      precoUnitarioAplicado: linha.precoUnitarioAplicado,
      valorImposto: linha.imposto,
      valorTotalItem: linha.totalItem,
    });
    await this.recalcularTotais(idOrcamento);
    this.logger.info({
      evento: 'orcamento_item_alterado',
      idOrcamento,
      idItem,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * Remove um item do orçamento (UC17).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   * @throws {ErroDeItemNaoEncontrado} Se o item não existir neste orçamento (404).
   */
  async removerItem(
    idOrcamento: number,
    idItem: number,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    await this.buscarItemOuFalhar(idOrcamento, idItem);
    await this.orcamentos.removerItem(idItem);
    await this.recalcularTotais(idOrcamento);
    this.logger.info({
      evento: 'orcamento_item_removido',
      idOrcamento,
      idItem,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * Grava as condições comerciais escolhidas pelo operador (UC18).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   */
  async atualizarCondicoes(
    idOrcamento: number,
    dados: DadosDasCondicoesAtualizar,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    const itens = await this.orcamentos.listarItens(idOrcamento);
    const valorTotalItens = itens.reduce((total, item) => total + item.valorTotalItem, 0);
    const frete = calcularFrete({
      valorTotalItens,
      origemTransportadora: dados.origemTransportadora,
      valorFreteCotado: dados.valorFrete ?? null,
    });
    const dividaEmAberto = await this.clientes.somarDividaEmAberto(orcamento.idCliente);
    const situacao = await obterSituacaoCliente(
      this.proxy,
      orcamento.idCliente,
      dividaEmAberto,
      OPERACAO_SITUACAO_CLIENTE,
    );
    const faturamento = this.calcularFaturamento(
      valorTotalItens,
      orcamento.primeiraCompra,
      situacao.creditoAprovado,
      {
        condicaoPagamento: dados.condicaoPagamento,
        prazoDias: dados.prazoDias,
        numeroParcelas: dados.numeroParcelas,
      },
    );
    const valorFreteFinal = frete.modalidade === 'CIF' ? null : frete.valorFrete;
    await this.orcamentos.atualizarCondicoes(
      idOrcamento,
      {
        condicaoPagamento: faturamento.ok
          ? faturamento.condicao
          : (dados.condicaoPagamento ?? orcamento.condicaoPagamento),
        prazoDias: faturamento.ok ? faturamento.prazoDias : null,
        numeroParcelas: faturamento.ok ? faturamento.numeroParcelas : null,
        modalidadeFrete: frete.modalidade,
        origemTransportadora: frete.origemTransportadora,
        transportadora: dados.transportadora ?? null,
        valorFrete: valorFreteFinal,
        freteProvisorio: frete.modalidade === 'FOB' ? frete.provisorio : false,
        valorTotalProposta: valorTotalItens + (valorFreteFinal ?? 0),
      },
      this.agora(),
    );
    const novoStatus: StatusDoOrcamento =
      faturamento.ok && faturamento.exigeAnaliseCredito && situacao.creditoAprovado === null
        ? STATUS_PENDENTE_CREDITO
        : orcamento.status === STATUS_PENDENTE_CREDITO
          ? 'RASCUNHO'
          : orcamento.status;
    if (novoStatus !== orcamento.status) {
      await this.mudarStatus(idOrcamento, orcamento.status, novoStatus, autor, null);
    }
    this.logger.info({
      evento: 'orcamento_condicoes_atualizadas',
      idOrcamento,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * Emite o orçamento (UC19): confere as pendências, gera o número e a chave de segurança, cria
   * as reservas e aprova o pedido de origem.
   *
   * @throws {ErroDeOrcamentoNaoEncontrado} Se o orçamento não existir (404).
   * @throws {ErroDeEmissaoBloqueada} Se houver pendências (422, `detalhes.bloqueios`).
   */
  async emitir(idOrcamento: number, autor: Sessao): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    const detalhe = await this.montarDetalhe(orcamento);
    if (detalhe.condicoes.bloqueios.length > 0) {
      throw new ErroDeEmissaoBloqueada(detalhe.condicoes.bloqueios);
    }
    await this.orcamentos.emitir(idOrcamento, autor.idOperador, () =>
      randomBytes(BYTES_DA_CHAVE_DE_SEGURANCA).toString('hex'),
    );
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: orcamento.status,
      statusNovo: 'ABERTO',
      observacao: null,
    });
    this.logger.info({ evento: 'orcamento_emitido', idOrcamento, idAutor: autor.idOperador });
    return this.obter(idOrcamento);
  }

  /**
   * Cancela o orçamento, com a justificativa opcional (UC06): se estava emitido (ABERTO), as
   * reservas de estoque são liberadas (UC06, passo 4).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o status não permitir cancelamento (RASCUNHO,
   * PENDENTE_CREDITO ou ABERTO; docs/04, seção 4.6).
   */
  async cancelar(idOrcamento: number, justificativa: string | null, autor: Sessao): Promise<void> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    if (!STATUS_DO_ORCAMENTO_CANCELAVEIS.has(orcamento.status)) {
      throw new ErroDeOrcamentoNaoEditavel();
    }
    if (orcamento.status === STATUS_ABERTO) {
      await this.orcamentos.liberarReservas(idOrcamento);
    }
    await this.orcamentos.cancelar(idOrcamento, this.agora());
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: orcamento.status,
      statusNovo: 'CANCELADO',
      observacao: justificativa,
    });
    this.logger.info({ evento: 'orcamento_cancelado', idOrcamento, idAutor: autor.idOperador });
  }

  /**
   * Cria (ou reabre, se já existir) o rascunho de uma nova versão a partir de um orçamento
   * recusado, com alteração solicitada ou com itens não aprovados (UC21, RF21): copia o
   * cabeçalho, os itens — com a aprovação herdada que o chamador já apurou — e as condições
   * comerciais, com vínculo a `idOrcamentoOrigem`. Implementa {@link GestorDeVersoesDeOrcamento}
   * para o módulo de respostas.
   *
   * @throws {ErroDeNovaVersaoNaoPermitida} Se a origem não estiver ABERTO ou
   * ALTERACAO_SOLICITADA (UC21-E1).
   */
  async criarNovaVersao(
    idOrcamentoOrigem: number,
    itens: readonly ItemParaNovaVersao[],
    autor: Sessao,
  ): Promise<number> {
    const origem = await this.buscarOuFalhar(idOrcamentoOrigem);
    if (!STATUS_DO_ORCAMENTO_PERMITEM_NOVA_VERSAO.has(origem.status)) {
      throw new ErroDeNovaVersaoNaoPermitida();
    }
    const rascunhoExistente = await this.orcamentos.buscarRascunhoDeVersao(idOrcamentoOrigem);
    if (rascunhoExistente) {
      return rascunhoExistente.idOrcamento;
    }
    const idOrcamento = await this.orcamentos.criar(
      {
        idCliente: origem.idCliente,
        idOperador: autor.idOperador,
        idEnderecoEntrega: origem.idEnderecoEntrega,
        idPedido: origem.idPedido,
        idOrcamentoOrigem: origem.idOrcamento,
        numeroSolicitacaoCompra: origem.numeroSolicitacaoCompra,
        contatoSolicitacao: origem.contatoSolicitacao,
        prazoEntregaDias: origem.prazoEntregaDias,
        primeiraCompra: origem.primeiraCompra,
      },
      this.agora(),
    );
    for (const item of itens) {
      await this.orcamentos.inserirItem(idOrcamento, item);
    }
    await this.orcamentos.atualizarCondicoes(
      idOrcamento,
      {
        condicaoPagamento: origem.condicaoPagamento,
        prazoDias: origem.prazoDias,
        numeroParcelas: origem.numeroParcelas,
        modalidadeFrete: origem.modalidadeFrete,
        origemTransportadora: origem.origemTransportadora,
        transportadora: origem.transportadora,
        valorFrete: origem.valorFrete,
        freteProvisorio: origem.freteProvisorio,
        valorTotalProposta: origem.valorTotalProposta,
      },
      this.agora(),
    );
    await this.recalcularTotais(idOrcamento);
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: null,
      statusNovo: 'RASCUNHO',
      observacao: `Nova versão do orçamento ${origem.numeroOrcamento ?? origem.idOrcamento}.`,
    });
    this.logger.info({
      evento: 'orcamento_nova_versao_criada',
      idOrcamentoOrigem,
      idOrcamento,
      idAutor: autor.idOperador,
    });
    return idOrcamento;
  }

  /**
   * Emite a nova versão (UC19) e, tendo sucesso, substitui o orçamento original: muda-o para
   * SUBSTITUIDO e libera as suas reservas (UC21, RF21). Implementa
   * {@link GestorDeVersoesDeOrcamento} para o módulo de respostas.
   *
   * @throws {ErroDeValidacao} Se o orçamento não for uma nova versão (sem `idOrcamentoOrigem`).
   */
  async emitirNovaVersao(idOrcamentoNovo: number, autor: Sessao): Promise<OrcamentoDetalhado> {
    const novaVersao = await this.buscarOuFalhar(idOrcamentoNovo);
    if (novaVersao.idOrcamentoOrigem === null) {
      throw new ErroDeValidacao({ detalhes: { campos: ['idOrcamento'] } });
    }
    const emitida = await this.emitir(idOrcamentoNovo, autor);
    const origem = await this.buscarOuFalhar(novaVersao.idOrcamentoOrigem);
    if (origem.status === STATUS_ABERTO || origem.status === 'ALTERACAO_SOLICITADA') {
      await this.orcamentos.liberarReservas(origem.idOrcamento);
    }
    await this.orcamentos.marcarSubstituido(origem.idOrcamento, this.agora());
    await this.orcamentos.registrarHistorico({
      idOrcamento: origem.idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: origem.status,
      statusNovo: 'SUBSTITUIDO',
      observacao: `Substituído pela versão ${emitida.numeroOrcamento ?? emitida.idOrcamento}.`,
    });
    this.logger.info({
      evento: 'orcamento_substituido_por_nova_versao',
      idOrcamentoOrigem: origem.idOrcamento,
      idOrcamentoNovo,
      idAutor: autor.idOperador,
    });
    return emitida;
  }

  // ----------------------------------------------------------------------------------------
  // Internos

  private async buscarOuFalhar(idOrcamento: number): Promise<Orcamento> {
    const orcamento = await this.orcamentos.buscarPorId(idOrcamento);
    if (!orcamento) {
      throw new ErroDeOrcamentoNaoEncontrado();
    }
    return orcamento;
  }

  private exigirEditavel(orcamento: Orcamento): void {
    if (!STATUS_DO_ORCAMENTO_EDITAVEIS.has(orcamento.status)) {
      throw new ErroDeOrcamentoNaoEditavel();
    }
  }

  private async buscarItemOuFalhar(idOrcamento: number, idItem: number): Promise<ItemDoOrcamento> {
    const itens = await this.orcamentos.listarItens(idOrcamento);
    const item = itens.find((candidato) => candidato.idItem === idItem);
    if (!item) {
      throw new ErroDeItemNaoEncontrado();
    }
    return item;
  }

  private async buscarVariacaoOuFalhar(idVariacao: number): Promise<VariacaoDeProduto> {
    const variacao = await this.produtos.buscarVariacaoComPrecos(idVariacao);
    if (!variacao) {
      throw new ErroDeVariacaoNaoEncontrada();
    }
    return variacao;
  }

  private fardoEscolhido(variacao: VariacaoDeProduto, idFardo: number) {
    const fardo = variacao.fardos.find((candidato) => candidato.idFardo === idFardo);
    if (!fardo) {
      throw new ErroDeValidacao({ detalhes: { campos: ['idFardo'] } });
    }
    return fardo;
  }

  private async verificarEstoque(
    idVariacao: number,
    variacao: VariacaoDeProduto,
    granularidade: 'FARDO' | 'AVULSO',
    quantidade: number,
  ): Promise<void> {
    const reservas = await somarReservasPorVariacao(this.proxy, [idVariacao], OPERACAO_SALDO_ITEM);
    const saldoDisponivel = calcularSaldoDisponivel(
      variacao.quantidadeEstoque,
      reservas.get(idVariacao) ?? 0,
    );
    const unidadesPorFardo =
      granularidade === 'FARDO' ? variacao.fardos.find(() => true)?.quantidadeUnidades : undefined;
    const resultado = validarDisponibilidadeEstoque({
      saldoDisponivel,
      quantidadeSolicitada: quantidade,
      granularidade,
      unidadesPorFardo,
    });
    if (!resultado.ok) {
      throw new ErroDeEstoqueIndisponivel(resultado.maximoDisponivel);
    }
  }

  private async inserirItemCalculado(
    idOrcamento: number,
    dados: {
      idVariacao: number;
      granularidade: 'FARDO' | 'AVULSO';
      idFardo: number | null;
      quantidade: number;
    },
  ): Promise<void> {
    const variacao = await this.buscarVariacaoOuFalhar(dados.idVariacao);
    const fardo = dados.idFardo === null ? undefined : this.fardoEscolhido(variacao, dados.idFardo);
    await this.verificarEstoque(dados.idVariacao, variacao, dados.granularidade, dados.quantidade);
    const linha = calcularLinhaDoItem({
      granularidade: dados.granularidade,
      quantidade: dados.quantidade,
      fardo,
      faixas: variacao.faixasPreco,
    });
    const item: ItemAInserir = {
      idVariacao: dados.idVariacao,
      granularidade: dados.granularidade,
      idFardo: dados.idFardo,
      quantidadeFardos: dados.granularidade === 'FARDO' ? dados.quantidade : null,
      idFaixaPreco: linha.idFaixaPreco,
      quantidadeAvulsa: dados.granularidade === 'AVULSO' ? dados.quantidade : null,
      precoUnitarioAplicado: linha.precoUnitarioAplicado,
      valorImposto: linha.imposto,
      valorTotalItem: linha.totalItem,
      aprovacaoHerdada: false,
    };
    await this.orcamentos.inserirItem(idOrcamento, item);
    await this.recalcularTotais(idOrcamento);
  }

  private async recalcularTotais(idOrcamento: number): Promise<void> {
    const itens = await this.orcamentos.listarItens(idOrcamento);
    const valorTotalItens = itens.reduce((total, item) => total + item.valorTotalItem, 0);
    const valorTotalImposto = itens.reduce((total, item) => total + item.valorImposto, 0);
    const orcamento = await this.orcamentos.buscarPorId(idOrcamento);
    const valorFrete = orcamento?.valorFrete ?? 0;
    await this.orcamentos.atualizarTotais(
      idOrcamento,
      {
        valorTotalItens: itens.length === 0 ? null : valorTotalItens,
        valorTotalImposto: itens.length === 0 ? null : valorTotalImposto,
        valorTotalProposta: itens.length === 0 ? null : valorTotalItens + valorFrete,
      },
      this.agora(),
    );
  }

  private async mudarStatus(
    idOrcamento: number,
    statusAnterior: StatusDoOrcamento,
    statusNovo: StatusDoOrcamento,
    autor: Sessao,
    observacao: string | null,
  ): Promise<void> {
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior,
      statusNovo,
      observacao,
    });
  }

  private calcularFaturamento(
    valorTotalItens: number,
    primeiraCompra: boolean,
    resultadoCredito: boolean | null,
    escolha: { condicaoPagamento?: string; prazoDias?: number; numeroParcelas?: number },
  ): ResultadoFaturamento {
    try {
      return validarCondicaoFaturamento({
        valorTotalItens,
        primeiraCompra,
        resultadoCredito:
          resultadoCredito === null ? null : resultadoCredito ? 'APROVADO' : 'REPROVADO',
        prazoDias: escolha.condicaoPagamento === 'BOLETO' ? escolha.prazoDias : undefined,
        numeroParcelas:
          escolha.condicaoPagamento === 'PARCELADO' ? escolha.numeroParcelas : undefined,
      });
    } catch (erro) {
      throw new ErroDeValidacao({ causa: erro });
    }
  }

  private async ehPrimeiraCompra(idCliente: number): Promise<boolean> {
    const situacao = await obterSituacaoCliente(
      this.proxy,
      idCliente,
      0,
      OPERACAO_SITUACAO_CLIENTE,
    );
    return situacao.primeiraCompra;
  }

  private async mapaDeClientes(
    idsDosClientes: readonly number[],
  ): Promise<Map<number, { razaoSocial: string; cnpj: string; status: string }>> {
    const unicos = [...new Set(idsDosClientes)];
    const clientes = await Promise.all(
      unicos.map((idCliente) => this.clientes.buscarPorId(idCliente)),
    );
    const mapa = new Map<number, { razaoSocial: string; cnpj: string; status: string }>();
    clientes.forEach((cliente, indice) => {
      if (cliente) {
        mapa.set(unicos[indice] as number, {
          razaoSocial: cliente.razaoSocial,
          cnpj: cliente.cnpj,
          status: cliente.status,
        });
      }
    });
    return mapa;
  }

  private paraResumo(
    orcamento: Orcamento,
    clientes: Map<number, { razaoSocial: string; cnpj: string; status: string }>,
  ): OrcamentoResumido {
    const cliente = clientes.get(orcamento.idCliente);
    return {
      idOrcamento: orcamento.idOrcamento,
      numeroOrcamento: orcamento.numeroOrcamento,
      idCliente: orcamento.idCliente,
      cliente: cliente?.razaoSocial ?? '',
      cnpj: cliente?.cnpj ?? '',
      dataEmissao: orcamento.dataEmissao,
      dataValidade: orcamento.dataValidade,
      diasParaVencer: this.diasParaVencer(orcamento.dataValidade),
      valorTotalProposta: orcamento.valorTotalProposta,
      status: orcamento.status,
    };
  }

  private diasParaVencer(dataValidade: string | null): number | null {
    if (dataValidade === null) {
      return null;
    }
    const milissegundosPorDia = 24 * 60 * 60 * 1000;
    const hoje = new Date(hojeComoDataISO(this.agora()));
    const validade = new Date(dataValidade);
    return Math.ceil((validade.getTime() - hoje.getTime()) / milissegundosPorDia);
  }

  private async montarDetalhe(orcamento: Orcamento): Promise<OrcamentoDetalhado> {
    const [itensDoOrcamento, cliente, historico, versoes] = await Promise.all([
      this.orcamentos.listarItens(orcamento.idOrcamento),
      this.clientes.buscarPorId(orcamento.idCliente),
      this.orcamentos.listarHistorico(orcamento.idOrcamento),
      this.orcamentos.listarVersoes(orcamento),
    ]);
    const historicoDetalhado = await this.detalharHistorico(historico);
    const itens = await this.detalharItens(itensDoOrcamento);
    const valorTotalItens = itens.reduce((total, item) => total + item.valorTotalItem, 0);
    const dividaEmAberto = cliente ? await this.clientes.somarDividaEmAberto(cliente.idCliente) : 0;
    const situacao = await obterSituacaoCliente(
      this.proxy,
      orcamento.idCliente,
      dividaEmAberto,
      OPERACAO_SITUACAO_CLIENTE,
    );
    const bloqueios: BloqueioDeEmissao[] = [];
    if (itens.length === 0) {
      bloqueios.push({ codigo: 'SEM_ITENS', mensagem: 'O orçamento não tem itens.' });
    }
    if (cliente && cliente.status !== 'ATIVO') {
      bloqueios.push({
        codigo: 'CLIENTE_BLOQUEADO',
        mensagem: 'Este cliente está inativo ou bloqueado.',
      });
    }
    if (dividaEmAberto > 0) {
      bloqueios.push({ codigo: 'DIVIDA_EM_ABERTO', mensagem: 'O cliente tem dívida em aberto.' });
    }
    let creditoStatus: CondicoesComerciais['creditoStatus'] = 'NAO_EXIGIDO';
    let condicoesPermitidas: readonly string[] = ['ADIANTADO_100', 'BOLETO', 'PARCELADO'];
    if (orcamento.primeiraCompra) {
      creditoStatus = 'NAO_EXIGIDO';
      condicoesPermitidas = ['ADIANTADO_100'];
    } else if (
      orcamento.condicaoPagamento === 'BOLETO' ||
      orcamento.condicaoPagamento === 'PARCELADO'
    ) {
      if (situacao.creditoAprovado === null) {
        creditoStatus = 'PENDENTE';
        bloqueios.push({
          codigo: 'PENDENTE_CREDITO',
          mensagem: 'A análise de crédito ainda não foi concluída.',
        });
      } else if (situacao.creditoAprovado) {
        creditoStatus = 'APROVADO';
      } else {
        creditoStatus = 'REPROVADO';
        condicoesPermitidas = ['ADIANTADO_100', 'ADIANTADO_50_50'];
      }
    }
    if (
      valorTotalItens > 0 &&
      valorTotalItens < 50000 &&
      orcamento.condicaoPagamento !== null &&
      !orcamento.primeiraCompra
    ) {
      bloqueios.push({
        codigo: 'ABAIXO_DO_MINIMO',
        mensagem: 'O valor total está abaixo do mínimo para faturamento a prazo.',
      });
    }
    for (const item of itensDoOrcamento) {
      const reservas = await somarReservasPorVariacao(
        this.proxy,
        [item.idVariacao],
        OPERACAO_SALDO_ITEM,
      );
      const variacao = await this.produtos.buscarVariacaoComPrecos(item.idVariacao);
      const saldo = calcularSaldoDisponivel(
        variacao?.quantidadeEstoque ?? 0,
        reservas.get(item.idVariacao) ?? 0,
      );
      const solicitado =
        item.granularidade === 'FARDO'
          ? (item.quantidadeFardos ?? 0)
          : (item.quantidadeAvulsa ?? 0);
      if (solicitado > saldo) {
        bloqueios.push({
          codigo: 'ESTOQUE_INSUFICIENTE',
          mensagem: 'Um ou mais itens não têm saldo suficiente no estoque.',
        });
        break;
      }
    }
    const condicoes: CondicoesComerciais = {
      valorTotalItens,
      valorTotalImposto: itens.reduce((total, item) => total + item.valorImposto, 0),
      modalidadeFrete: orcamento.modalidadeFrete,
      origemTransportadora: orcamento.origemTransportadora,
      transportadora: orcamento.transportadora,
      valorFrete: orcamento.valorFrete,
      freteProvisorio: orcamento.freteProvisorio,
      condicaoPagamento: orcamento.condicaoPagamento,
      condicoesPagamentoPermitidas: condicoesPermitidas,
      prazoDias: orcamento.prazoDias,
      numeroParcelas: orcamento.numeroParcelas,
      valorTotalProposta: orcamento.valorTotalProposta ?? valorTotalItens,
      creditoStatus,
      bloqueios,
    };
    return {
      ...this.paraResumo(
        orcamento,
        cliente
          ? new Map([
              [
                cliente.idCliente,
                { razaoSocial: cliente.razaoSocial, cnpj: cliente.cnpj, status: cliente.status },
              ],
            ])
          : new Map(),
      ),
      idPedido: orcamento.idPedido,
      numeroPedido: null,
      chaveSeguranca: orcamento.chaveSeguranca,
      numeroSolicitacaoCompra: orcamento.numeroSolicitacaoCompra,
      contato: orcamento.contatoSolicitacao,
      idEnderecoEntrega: orcamento.idEnderecoEntrega,
      prazoEntregaDias: orcamento.prazoEntregaDias,
      enderecosEntrega: (cliente?.enderecos ?? []).map((endereco) => ({
        idEndereco: endereco.idEndereco,
        tipo: endereco.tipo,
        logradouro: endereco.logradouro,
        numero: endereco.numero,
        complemento: endereco.complemento,
        bairro: endereco.bairro,
        cidade: endereco.cidade,
        uf: endereco.uf,
        cep: endereco.cep,
      })),
      itens,
      anexos: [],
      condicoes,
      historico: historicoDetalhado,
      versoes: versoes.map((versao) => ({
        idOrcamento: versao.idOrcamento,
        numeroOrcamento: versao.numeroOrcamento,
        status: versao.status,
      })),
    };
  }

  /** Resolve o `usuario` (login) de cada evento, para exibição (UC06). */
  private async detalharHistorico(
    eventos: readonly EventoDoHistorico[],
  ): Promise<EventoDeHistoricoDetalhado[]> {
    const idsDosOperadores = [
      ...new Set(
        eventos.map((evento) => evento.idOperador).filter((id): id is number => id !== null),
      ),
    ];
    const usuarios = await Promise.all(idsDosOperadores.map((id) => this.usuarios.buscarPorId(id)));
    const nomesPorId = new Map(
      usuarios
        .filter((usuario): usuario is NonNullable<typeof usuario> => usuario !== null)
        .map((usuario) => [usuario.idOperador, usuario.usuario]),
    );
    return eventos.map((evento) => ({
      tipoEvento: evento.tipoEvento,
      statusAnterior: evento.statusAnterior,
      statusNovo: evento.statusNovo,
      observacao: evento.observacao,
      usuario: evento.idOperador === null ? null : (nomesPorId.get(evento.idOperador) ?? null),
      dataRegistro: evento.dataRegistro,
    }));
  }

  private async detalharItens(itens: readonly ItemDoOrcamento[]): Promise<ItemDetalhado[]> {
    const idsDasVariacoes = [...new Set(itens.map((item) => item.idVariacao))];
    const variacoes = await this.produtos.buscarVariacoesPorId(idsDasVariacoes);
    const porId = new Map(variacoes.map((variacao) => [variacao.idVariacao, variacao]));
    return itens.map((item) => {
      const variacao = porId.get(item.idVariacao);
      return {
        idItem: item.idItem,
        idVariacao: item.idVariacao,
        produto: variacao?.descricaoDoProduto ?? '',
        marca: variacao?.marca ?? '',
        embalagem: variacao?.tamanhoEmbalagem ?? '',
        granularidade: item.granularidade,
        quantidade:
          item.granularidade === 'FARDO'
            ? (item.quantidadeFardos ?? 0)
            : (item.quantidadeAvulsa ?? 0),
        precoUnitarioAplicado: item.precoUnitarioAplicado,
        valorLinha: item.valorTotalItem - item.valorImposto,
        valorImposto: item.valorImposto,
        valorTotalItem: item.valorTotalItem,
        aprovacaoHerdada: item.aprovacaoHerdada,
      };
    });
  }
}
