// UC01, UC05, UC14-19 — regras do orçamento: rascunho, itens, condições comerciais, emissão e
// cancelamento. Implementa `MontadorDeOrcamentos` para o módulo de pedidos (UC10 → UC14).
import { randomBytes } from 'node:crypto';
import { LeitorEmLote, type ClienteDeProxy } from '../../dados';
import {
  ErroDeArquivoNaoEncontrado,
  type ArmazenamentoDeArquivos,
} from '../../dados/armazenamento';
import type { DadosDaEmpresaEmissora } from '../../config';
import {
  ErroDeAnexoNaoEncontrado,
  ErroDeClienteBloqueado,
  ErroDeClienteNaoEncontrado,
  ErroDeEmissaoBloqueada,
  ErroDeEstoqueIndisponivel,
  ErroDeItemNaoEncontrado,
  ErroDeNovaVersaoNaoPermitida,
  ErroDeEnvioNaoPermitido,
  ErroDeOrcamentoNaoEditavel,
  ErroDeOrcamentoNaoEncontrado,
  ErroDePdfIndisponivel,
  ErroDeServicoIndisponivel,
  ErroDeValidacao,
  ErroDeVariacaoNaoEncontrada,
} from '../../erros';
import type { EnviadorDeEmail } from '../../email/enviador';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import { RepositorioDeClientes, type ClienteCadastrado } from '../clientes/repositorio';
import type {
  HistoricoDeCompraDoCliente,
  LeitorDeOrcamentosDoCliente,
  OrcamentoEmAbertoDoCliente,
} from '../clientes/servico';
import { calcularSaldoDisponivel, somarReservasPorVariacao } from '../comum/estoque';
import { obterSituacaoCliente } from '../comum/situacaoCliente';
import {
  calcularFaltaParaFaturamentoMinimo,
  calcularFrete,
  calcularLinhaDoItem,
  escolherCondicaoPadrao,
  FATURAMENTO_MINIMO,
  listarCondicoesPermitidas,
  hojeComoDataISO,
  validarCondicaoFaturamento,
  validarDisponibilidadeEstoque,
  type ResultadoFaturamento,
} from '../cotacao/calculoAdapter';
import type { GestorDeOrcamentoParaCredito } from '../credito/servico';
import { RepositorioDePedidos, type ItemDePedido, type Pedido } from '../pedidos/repositorio';
import type { MontadorDeOrcamentos } from '../pedidos/servico';
import {
  RepositorioDeProdutos,
  type VariacaoComProduto,
  type VariacaoDeProduto,
} from '../produtos/repositorio';
import { RepositorioDeRespostas } from '../respostas/repositorio';
import type { GestorDeVersoesDeOrcamento, ItemParaNovaVersao } from '../respostas/servico';
import { RepositorioDeUsuarios } from '../usuarios/repositorio';
import {
  RepositorioDeOrcamentos,
  STATUS_DO_ORCAMENTO_EDITAVEIS,
  STATUS_DO_ORCAMENTO_EM_ABERTO,
  type AlteracaoDeCabecalho,
  type AnexoAInserir,
  type AnexoDoOrcamento,
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
import { gerarPdfDeOrcamento } from './pdf';

const OPERACAO_SITUACAO_CLIENTE = 'UC14-situacao-cliente';
const OPERACAO_SALDO_ITEM = 'UC15-saldo-item';
const OPERACAO_DETALHE = 'UC15-detalhe-orcamento';
const BYTES_DA_CHAVE_DE_SEGURANCA = 24;
/** Observação do evento de histórico registrado por `enviar` (UC08, variação A1). */
const MENSAGEM_DO_HISTORICO_DE_ENVIO = 'Documento enviado ao cliente.';

function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
/** Valor abaixo do qual um resultado de crédito reprovado não bloqueia (50% adiantado cobre). */
const STATUS_PENDENTE_CREDITO: StatusDoOrcamento = 'PENDENTE_CREDITO';
/** Status sem número de orçamento, os únicos que o banco deixa editar (gatilho de imutabilidade). */
const STATUS_DE_RASCUNHO: ReadonlySet<StatusDoOrcamento> = new Set([
  'RASCUNHO',
  STATUS_PENDENTE_CREDITO,
]);
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

/** O que `carregarBaseDasCondicoes` lê para calcular condições e bloqueios. */
interface BaseDasCondicoes {
  readonly itensDoOrcamento: readonly ItemDoOrcamento[];
  readonly cliente: ClienteCadastrado | null;
  readonly dividaEmAberto: number;
  readonly creditoAprovado: boolean | null;
  readonly variacoes: readonly VariacaoComProduto[];
  /** Reservas CONFIRMADA por variação (RN14). */
  readonly reservas: ReadonlyMap<number, number>;
  /** Unidades por fardo, por `idFardo`, para conferir o estoque dos itens FARDO. */
  readonly unidadesDosFardos: ReadonlyMap<number, number>;
}

const FORMATADOR_DE_REAIS = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Centavos como "R$ 1.500,00", para as mensagens de bloqueio (texto de docs/10, tela 6). */
function formatarReais(centavos: number): string {
  return `R$ ${FORMATADOR_DE_REAIS.format(centavos / 100)}`;
}

/** Rótulo de cada condição, para a mensagem de condição não permitida. */
const ROTULO_DA_CONDICAO: Record<string, string> = {
  ADIANTADO_100: '100% adiantado',
  ADIANTADO_50_50: '50% adiantado e 50% após a entrega',
  BOLETO: 'boleto',
  PARCELADO: 'parcelado',
};

export interface BloqueioDeEmissao {
  readonly codigo:
    | 'ABAIXO_DO_MINIMO'
    | 'CONDICAO_NAO_PERMITIDA'
    | 'FRETE_PROVISORIO'
    | 'PENDENTE_CREDITO'
    | 'DIVIDA_EM_ABERTO'
    | 'ESTOQUE_INSUFICIENTE'
    | 'CLIENTE_BLOQUEADO'
    | 'CONDICOES_INCOMPLETAS'
    | 'SEM_ITENS';
  readonly mensagem: string;
}

/** Aviso ao operador sobre algo que o sistema fez sozinho (UC18). */
export interface AvisoDoOrcamento {
  readonly codigo: 'CONDICAO_TROCADA_AUTOMATICAMENTE';
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
  /**
   * Avisos que não impedem a emissão. Só a resposta da mutação que causou o aviso os traz (o `GET`
   * devolve `[]`): hoje, `CONDICAO_TROCADA_AUTOMATICAMENTE`.
   */
  readonly avisos: readonly AvisoDoOrcamento[];
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
  /** Código interno do produto, usado na tabela do PDF de orçamento (docs/09). */
  readonly codigoInterno: string;
  /** NCM do produto; `null` quando não aplicável. */
  readonly ncm: string | null;
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

/**
 * Anexo exposto ao frontend (UC19). Sem `caminhoArquivo`/`tamanhoBytes`: são detalhes de
 * armazenamento que a tela de montagem do orçamento não usa (`frontend/src/api/types.ts`).
 */
export interface AnexoDetalhado {
  readonly idAnexo: number;
  readonly tipoAnexo: AnexoDoOrcamento['tipoAnexo'];
  readonly nomeArquivo: string;
}

/** Operador identificado no aviso de edição de rascunho (nome de exibição = nome de usuário). */
export interface OperadorIdentificado {
  readonly idOperador: number;
  readonly nome: string;
}

/** Última edição do rascunho feita por um operador que não é o responsável. */
export interface AlteracaoDeOutroOperador extends OperadorIdentificado {
  readonly data: string;
}

export interface OrcamentoDetalhado extends OrcamentoResumido {
  /** Operador responsável (`orcamento.id_operador`); `nome` vem do cadastro de usuários. */
  readonly responsavel: OperadorIdentificado;
  /**
   * Última edição do rascunho feita por outro operador que não o responsável, ou `null`. Vem de
   * `orcamento.id_operador_ultima_edicao` (migration 20261117000000), gravada a cada edição de
   * itens, cabeçalho e condições; `data` é `data_ultima_edicao`. Quando o responsável volta a
   * editar, a coluna passa a ser dele e o aviso some. Em orçamentos anteriores à coluna (nula),
   * usa o evento mais recente do histórico feito por outro operador.
   */
  readonly ultimaAlteracaoDeOutro: AlteracaoDeOutroOperador | null;
  readonly idPedido: number | null;
  readonly numeroPedido: string | null;
  readonly chaveSeguranca: string | null;
  readonly numeroSolicitacaoCompra: string | null;
  readonly contato: string | null;
  readonly idEnderecoEntrega: number | null;
  readonly prazoEntregaDias: number | null;
  readonly enderecosEntrega: readonly EnderecoDetalhado[];
  readonly itens: readonly ItemDetalhado[];
  readonly anexos: readonly AnexoDetalhado[];
  readonly condicoes: CondicoesComerciais;
  readonly historico: readonly EventoDeHistoricoDetalhado[];
  readonly versoes: readonly VersaoDetalhada[];
}

/**
 * O que o módulo de crédito (UC07) precisa pedir ao orçamento: abrir uma análise quando ele
 * entra em PENDENTE_CREDITO. Implementado por `ServicoDeAnaliseCredito`; injetado depois da
 * construção (ver {@link ServicoDeOrcamentos.definirGestorDeAnaliseCredito}), porque os dois
 * serviços dependem um do outro e o módulo de orçamentos é montado primeiro.
 */
export interface GestorDeAnaliseDeCredito {
  /** Idempotente: se já houver uma análise pendente para o cliente, não abre outra. */
  solicitarAnalise(dados: { idCliente: number; idOrcamento: number }): Promise<void>;
}

export interface DependenciasDoServicoDeOrcamentos {
  readonly orcamentos: RepositorioDeOrcamentos;
  readonly clientes: RepositorioDeClientes;
  readonly produtos: RepositorioDeProdutos;
  readonly usuarios: RepositorioDeUsuarios;
  readonly proxy: ClienteDeProxy;
  /** Guarda os bytes dos anexos (UC19, RF11). */
  readonly armazenamento: ArmazenamentoDeArquivos;
  readonly logger: Logger;
  /** Cabeçalho/rodapé do PDF de orçamento (UC19, docs/09). */
  readonly empresaEmissora: DadosDaEmpresaEmissora;
  /** Envia o PDF por e-mail (UC08). Ausente (sem `RESEND_API_KEY`): só registra em log. */
  readonly enviadorDeEmail?: EnviadorDeEmail;
  readonly agora?: () => Date;
}

/** Upload de anexo já recebido do multipart (UC19). */
export interface DadosDoUploadDeAnexo {
  readonly tipoAnexo: AnexoAInserir['tipoAnexo'];
  readonly nomeArquivo: string;
  readonly tipoConteudo: string;
  readonly conteudo: Buffer;
}

/** Regras do orçamento (UC01, UC05, UC14-19). */
export class ServicoDeOrcamentos
  implements
    MontadorDeOrcamentos,
    LeitorDeOrcamentosDoCliente,
    GestorDeVersoesDeOrcamento,
    GestorDeOrcamentoParaCredito
{
  private readonly orcamentos: RepositorioDeOrcamentos;
  private readonly clientes: RepositorioDeClientes;
  private readonly produtos: RepositorioDeProdutos;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly pedidos: RepositorioDePedidos;
  private readonly proxy: ClienteDeProxy;
  private readonly armazenamento: ArmazenamentoDeArquivos;
  private readonly logger: Logger;
  private readonly empresaEmissora: DadosDaEmpresaEmissora;
  private readonly enviadorDeEmail: EnviadorDeEmail | undefined;
  private readonly agora: () => Date;
  private analiseDeCredito?: GestorDeAnaliseDeCredito;

  constructor(dependencias: DependenciasDoServicoDeOrcamentos) {
    this.orcamentos = dependencias.orcamentos;
    this.clientes = dependencias.clientes;
    this.produtos = dependencias.produtos;
    this.usuarios = dependencias.usuarios;
    this.pedidos = new RepositorioDePedidos(dependencias.proxy);
    this.proxy = dependencias.proxy;
    this.armazenamento = dependencias.armazenamento;
    this.logger = dependencias.logger;
    this.empresaEmissora = dependencias.empresaEmissora;
    this.enviadorDeEmail = dependencias.enviadorDeEmail;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /**
   * Liga o serviço de análise de crédito, montado depois deste (os dois serviços dependem um do
   * outro). Sem isto, entrar em PENDENTE_CREDITO não abre a análise (UC07).
   */
  definirGestorDeAnaliseCredito(gestor: GestorDeAnaliseDeCredito): void {
    this.analiseDeCredito = gestor;
  }

  /**
   * Cria o orçamento do zero (UC14, sem pedido de origem).
   *
   * @throws {ErroDeClienteNaoEncontrado} Se o cliente não existir (404).
   * @throws {ErroDeClienteBloqueado} Se o cliente estiver INATIVO, BLOQUEADO ou com dívida
   * EM_ABERTO/PROTESTADA (422, UC14-E1/E2, RN06). A recusa vem antes dos gatilhos do banco
   * (CLIENTE_INATIVO, CLIENTE_INADIMPLENTE), com mensagem própria.
   */
  async criar(dados: DadosDoOrcamentoNovo, autor: Sessao): Promise<OrcamentoDetalhado> {
    await this.exigirClienteLiberado(dados.idCliente);
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
    return this.detalharAposEdicao(idOrcamento, autor, true);
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
      await this.inserirItemCalculado(
        idOrcamento,
        {
          idVariacao: item.idVariacao,
          granularidade: item.granularidade,
          idFardo: item.idFardo,
          quantidade: item.quantidadeSolicitada,
        },
        autor.idOperador,
      );
    }
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'MUDANCA_STATUS',
      statusAnterior: null,
      statusNovo: 'RASCUNHO',
      observacao: null,
    });
    await this.aplicarCondicaoPadrao(await this.buscarOuFalhar(idOrcamento), autor, true);
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
   * Histórico de compras do cliente (RF04, RF07): orçamentos ACEITO, com o valor aceito
   * (`resposta_orcamento.valor_total_aceito`, UC20). Implementa
   * {@link LeitorDeOrcamentosDoCliente} para o módulo de clientes.
   */
  async listarHistoricoDeCompras(idCliente: number): Promise<HistoricoDeCompraDoCliente[]> {
    const orcamentos = await this.orcamentos.listar({
      e: [
        ['id_cliente', '=', idCliente],
        ['status', '=', STATUS_ACEITO],
      ],
    });
    const valoresAceitos = await new RepositorioDeRespostas(this.proxy).valoresAceitosPorOrcamento(
      orcamentos.map((orcamento) => orcamento.idOrcamento),
    );
    return orcamentos
      .filter(
        (orcamento): orcamento is Orcamento & { numeroOrcamento: number; dataEmissao: string } =>
          orcamento.numeroOrcamento !== null && orcamento.dataEmissao !== null,
      )
      .map((orcamento) => ({
        idOrcamento: orcamento.idOrcamento,
        numeroOrcamento: orcamento.numeroOrcamento,
        dataEmissao: orcamento.dataEmissao,
        // O valor efetivamente aceito (UC20); sem resposta aceita registrada, cai no proposto.
        valorTotalAceito:
          valoresAceitos.get(orcamento.idOrcamento) ?? orcamento.valorTotalProposta ?? 0,
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
    await this.orcamentos.atualizarCabecalho(
      idOrcamento,
      alteracao,
      this.agora(),
      this.editorDoRascunho(orcamento, autor),
    );
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
    await this.inserirItemCalculado(
      idOrcamento,
      {
        idVariacao: dados.idVariacao,
        granularidade: dados.granularidade,
        idFardo: dados.idFardo ?? null,
        quantidade: dados.quantidade,
      },
      autor.idOperador,
    );
    this.logger.info({
      evento: 'orcamento_item_adicionado',
      idOrcamento,
      idAutor: autor.idOperador,
    });
    return this.detalharAposEdicao(idOrcamento, autor, true);
  }

  /**
   * Anexa um arquivo ao orçamento (UC19).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   */
  async anexar(
    idOrcamento: number,
    dados: DadosDoUploadDeAnexo,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    // Primeiro o objeto, depois a linha: se salvar falhar, nada é gravado no banco.
    const caminhoArquivo = await this.armazenamento.salvar({
      idOrcamento,
      nomeArquivo: dados.nomeArquivo,
      tipoConteudo: dados.tipoConteudo,
      conteudo: dados.conteudo,
    });
    try {
      await this.orcamentos.inserirAnexo(idOrcamento, {
        tipoAnexo: dados.tipoAnexo,
        nomeArquivo: dados.nomeArquivo,
        caminhoArquivo,
        tamanhoBytes: dados.conteudo.length,
      });
    } catch (erro) {
      // Compensação: sem linha, o objeto ficaria órfão. Falha ao compensar só vira log.
      await this.armazenamento.remover(caminhoArquivo).catch((falha: unknown) => {
        this.logger.warn(
          { evento: 'orcamento_anexo_objeto_orfao', idOrcamento, err: falha },
          'não foi possível remover o arquivo após falha ao gravar o anexo',
        );
      });
      throw erro;
    }
    this.logger.info({
      evento: 'orcamento_anexo_adicionado',
      idOrcamento,
      tipoAnexo: dados.tipoAnexo,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * Remove um anexo do orçamento (UC19).
   *
   * @throws {ErroDeOrcamentoNaoEditavel} Se o orçamento não estiver em um status editável (422).
   * @throws {ErroDeAnexoNaoEncontrado} Se o anexo não existir neste orçamento (404).
   */
  async removerAnexo(
    idOrcamento: number,
    idAnexo: number,
    autor: Sessao,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    this.exigirEditavel(orcamento);
    const anexo = await this.buscarAnexoOuFalhar(idOrcamento, idAnexo);
    await this.orcamentos.removerAnexo(idAnexo);
    // Remoção parcial: a linha é a fonte de verdade e já foi removida; se o objeto não puder ser
    // removido agora, a requisição não falha (o anexo sumiu para o usuário) e o objeto órfão é
    // registrado em log para limpeza posterior. Repetir a requisição daria 404.
    await this.armazenamento.remover(anexo.caminhoArquivo).catch((falha: unknown) => {
      this.logger.warn(
        { evento: 'orcamento_anexo_objeto_orfao', idOrcamento, idAnexo, err: falha },
        'anexo removido, mas o arquivo não pôde ser removido do armazenamento',
      );
    });
    this.logger.info({
      evento: 'orcamento_anexo_removido',
      idOrcamento,
      idAnexo,
      idAutor: autor.idOperador,
    });
    return this.obter(idOrcamento);
  }

  /**
   * URL assinada, de curta duração, para baixar o arquivo de um anexo (UC19, RF11).
   *
   * @throws {ErroDeOrcamentoNaoEncontrado} Se o orçamento não existir (404).
   * @throws {ErroDeAnexoNaoEncontrado} Se o anexo não existir neste orçamento ou o arquivo faltar
   * no armazenamento (404).
   */
  async obterUrlDoAnexo(
    idOrcamento: number,
    idAnexo: number,
  ): Promise<{ url: string; expiraEm: string }> {
    await this.buscarOuFalhar(idOrcamento);
    const anexo = await this.buscarAnexoOuFalhar(idOrcamento, idAnexo);
    try {
      return await this.armazenamento.gerarUrlAssinada(anexo.caminhoArquivo);
    } catch (erro) {
      if (erro instanceof ErroDeArquivoNaoEncontrado) {
        throw new ErroDeAnexoNaoEncontrado();
      }
      throw erro;
    }
  }

  /**
   * Gera o PDF do orçamento (docs/09), para impressão, download ou envio ao cliente (UC08).
   *
   * @throws {ErroDePdfIndisponivel} Se o orçamento ainda não foi emitido (sem número).
   */
  async gerarPdf(idOrcamento: number): Promise<Buffer> {
    const detalhe = await this.obter(idOrcamento);
    if (detalhe.numeroOrcamento === null) {
      throw new ErroDePdfIndisponivel();
    }
    return gerarPdfDeOrcamento(detalhe, this.empresaEmissora);
  }

  /**
   * Envia o PDF do orçamento por e-mail ao vendedor responsável e registra o evento no histórico
   * (UC08, variação A1). O vendedor responsável é o da carteira do cliente
   * (`cliente.id_operador_vendedor`, o mesmo do pedido de origem); o e-mail vem de `operador`. Sem
   * vendedor utilizável (inexistente ou INATIVO), o envio vai ao próprio operador.
   *
   * Ordem: o e-mail sai ANTES de gravar o evento. Se o provedor falhar, nada é gravado e a
   * resposta é 503 (repetir é seguro). Se o e-mail sair e a gravação falhar, o vendedor já tem o
   * PDF e o operador pode repetir; preferimos isso a registrar um envio que não aconteceu.
   * Sem `enviadorDeEmail` (modo mudo), o fluxo segue e só há log, sem endereço nem conteúdo.
   *
   * @throws {ErroDeEnvioNaoPermitido} Se o orçamento não estiver ABERTO (emitido e vigente) ou
   * tiver pendência de crédito (422, UC08-E1).
   * @throws {ErroDeServicoIndisponivel} Se o provedor de e-mail falhar (503).
   */
  async enviar(idOrcamento: number, autor: Sessao): Promise<void> {
    const detalhe = await this.obter(idOrcamento);
    if (
      detalhe.numeroOrcamento === null ||
      detalhe.status !== STATUS_ABERTO ||
      detalhe.condicoes.creditoStatus === 'PENDENTE'
    ) {
      throw new ErroDeEnvioNaoPermitido();
    }
    if (this.enviadorDeEmail === undefined) {
      this.logger.warn(
        { evento: 'email_nao_enviado', tipo: 'orcamento', idOrcamento },
        'E-mail do orçamento não enviado: o envio de e-mails não está configurado.',
      );
    } else {
      const destinatario = await this.descobrirDestinatarioDoEnvio(
        detalhe.idPedido,
        detalhe.idCliente,
        autor,
      );
      const numero = detalhe.numeroOrcamento;
      const pdf = await gerarPdfDeOrcamento(detalhe, this.empresaEmissora);
      try {
        await this.enviadorDeEmail.enviar({
          para: destinatario,
          assunto: `Orçamento ${numero} - SupriMax`,
          texto: `Olá,

segue em anexo o orçamento ${numero}, emitido por ${autor.usuario}.

SupriMax`,
          html: `<p>Olá,</p><p>segue em anexo o orçamento <strong>${numero}</strong>, emitido por ${escaparHtml(autor.usuario)}.</p><p>SupriMax</p>`,
          anexos: [{ nomeArquivo: `orcamento-${idOrcamento}.pdf`, conteudo: pdf }],
        });
      } catch (erro) {
        this.logger.error(
          { evento: 'orcamento_email_falhou', idOrcamento, err: erro },
          'o provedor de e-mail não enviou o orçamento',
        );
        throw new ErroDeServicoIndisponivel({ causa: erro });
      }
    }
    await this.orcamentos.registrarHistorico({
      idOrcamento,
      idOperador: autor.idOperador,
      tipoEvento: 'ATUALIZACAO_FOLLOWUP',
      statusAnterior: detalhe.status,
      statusNovo: detalhe.status,
      observacao: MENSAGEM_DO_HISTORICO_DE_ENVIO,
    });
    this.logger.info({ evento: 'orcamento_enviado', idOrcamento, idAutor: autor.idOperador });
  }

  /**
   * Destinatário do envio (UC08-A1), em cascata e lendo só o necessário: (1) vendedor do pedido de
   * origem, se o orçamento tem pedido; (2) vendedor da carteira do cliente; (3) o operador logado.
   * Um vendedor só serve se estiver ATIVO e com e-mail.
   */
  private async descobrirDestinatarioDoEnvio(
    idPedido: number | null,
    idCliente: number,
    autor: Sessao,
  ): Promise<string> {
    if (idPedido !== null) {
      const pedido = await this.pedidos.buscarPorId(idPedido);
      const email = pedido && (await this.emailDoVendedor(pedido.idOperadorVendedor));
      if (email) {
        return email;
      }
    }
    const cliente = await this.clientes.buscarPorId(idCliente);
    const email = cliente && (await this.emailDoVendedor(cliente.idOperadorVendedor));
    if (email) {
      return email;
    }
    this.logger.warn(
      { evento: 'orcamento_envio_sem_vendedor', idCliente },
      'vendedor responsável sem e-mail utilizável; o orçamento vai ao operador',
    );
    return autor.email;
  }

  private async emailDoVendedor(idOperador: number): Promise<string | null> {
    const vendedor = await this.usuarios.buscarPorId(idOperador);
    return vendedor !== null && vendedor.status === 'ATIVO' && vendedor.email !== ''
      ? vendedor.email
      : null;
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
    await this.recalcularTotais(idOrcamento, autor.idOperador);
    this.logger.info({
      evento: 'orcamento_item_alterado',
      idOrcamento,
      idItem,
      idAutor: autor.idOperador,
    });
    return this.detalharAposEdicao(idOrcamento, autor, true);
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
    await this.recalcularTotais(idOrcamento, autor.idOperador);
    this.logger.info({
      evento: 'orcamento_item_removido',
      idOrcamento,
      idItem,
      idAutor: autor.idOperador,
    });
    return this.detalharAposEdicao(idOrcamento, autor, true);
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
    let frete: ReturnType<typeof calcularFrete>;
    try {
      frete = calcularFrete({
        valorTotalItens,
        origemTransportadora: dados.origemTransportadora,
        valorFreteCotado: dados.valorFrete ?? null,
      });
    } catch (erro) {
      // Frete FOB (abaixo de R$ 1.500,00) sem `origemTransportadora`: entrada inválida (400), não 500.
      throw new ErroDeValidacao({ causa: erro });
    }
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
      this.editorDoRascunho(orcamento, autor),
    );
    // `faturamento.ok` só é `true` quando a condição já tem resultado de crédito definido (ou não
    // precisa de um): com `creditoAprovado === null`, `validarCondicaoFaturamento` recusa com o
    // motivo CREDITO_PENDENTE em vez de aprovar com `exigeAnaliseCredito`. É esse motivo, não
    // `faturamento.ok`, que sinaliza que esta escolha precisa da análise de crédito (UC07).
    const novoStatus: StatusDoOrcamento =
      !faturamento.ok && faturamento.motivo === 'CREDITO_PENDENTE'
        ? STATUS_PENDENTE_CREDITO
        : orcamento.status === STATUS_PENDENTE_CREDITO
          ? 'RASCUNHO'
          : orcamento.status;
    if (novoStatus !== orcamento.status) {
      await this.mudarStatus(idOrcamento, orcamento.status, novoStatus, autor, null);
      if (novoStatus === STATUS_PENDENTE_CREDITO) {
        // UC07: abre a análise de crédito do cliente, se ainda não houver uma pendente.
        await this.analiseDeCredito?.solicitarAnalise({
          idCliente: orcamento.idCliente,
          idOrcamento,
        });
      }
    }
    this.logger.info({
      evento: 'orcamento_condicoes_atualizadas',
      idOrcamento,
      idAutor: autor.idOperador,
    });
    // A escolha explícita do operador não é desfeita aqui (segue como bloqueio
    // CONDICAO_NAO_PERMITIDA); só preenche o padrão se ainda não houver condição.
    return this.detalharAposEdicao(idOrcamento, autor, false);
  }

  /**
   * Implementa `GestorDeOrcamentoParaCredito` (UC07): quando o fiscal registra o resultado da
   * análise, o orçamento vinculado sai de PENDENTE_CREDITO e volta a RASCUNHO — tanto aprovado
   * quanto reprovado, pois os dois casos exigem que o operador reabra as condições comerciais
   * para a tela recalcular (aprovado: libera o faturamento normal; reprovado: só restam as
   * condições que não exigem análise, ex.: adiantado). Idempotente: se o orçamento já não
   * estiver mais PENDENTE_CREDITO (ex.: cancelado nesse meio-tempo), não faz nada.
   */
  async resolverPendenciaDeCredito(idOrcamento: number, autor: Sessao): Promise<void> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    if (orcamento.status !== STATUS_PENDENTE_CREDITO) {
      return;
    }
    await this.mudarStatus(idOrcamento, orcamento.status, 'RASCUNHO', autor, null);
    this.logger.info(
      { evento: 'orcamento_credito_resolvido', idOrcamento, idAutor: autor.idOperador },
      'Pendência de crédito resolvida; orçamento voltou a RASCUNHO.',
    );
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
    // Só as condições: o detalhe completo é montado uma vez, ao devolver o orçamento já emitido.
    const { bloqueios } = this.avaliarCondicoes(
      orcamento,
      await this.carregarBaseDasCondicoes(orcamento, this.leitoresEmLote()),
    );
    if (bloqueios.length > 0) {
      throw new ErroDeEmissaoBloqueada(bloqueios);
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
      autor.idOperador,
    );
    await this.recalcularTotais(idOrcamento, autor.idOperador);
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

  private async buscarAnexoOuFalhar(
    idOrcamento: number,
    idAnexo: number,
  ): Promise<AnexoDoOrcamento> {
    const anexos = await this.orcamentos.listarAnexos(idOrcamento);
    const anexo = anexos.find((candidato) => candidato.idAnexo === idAnexo);
    if (!anexo) {
      throw new ErroDeAnexoNaoEncontrado();
    }
    return anexo;
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
    idOperadorEdicao: number,
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
    await this.recalcularTotais(idOrcamento, idOperadorEdicao);
  }

  /**
   * Devolve o detalhe depois de uma edição, aplicando antes a condição de pagamento padrão (UC18)
   * e anexando o aviso se ela foi trocada.
   */
  private async detalharAposEdicao(
    idOrcamento: number,
    autor: Sessao,
    reverterInvalida: boolean,
  ): Promise<OrcamentoDetalhado> {
    const orcamento = await this.buscarOuFalhar(idOrcamento);
    const { orcamento: atualizado, avisos } = await this.aplicarCondicaoPadrao(
      orcamento,
      autor,
      reverterInvalida,
    );
    return this.montarDetalhe(atualizado, avisos);
  }

  /**
   * Condição de pagamento automática (UC18). Em rascunho: se não há condição, grava o padrão de
   * `escolherCondicaoPadrao`; se `reverterInvalida` e a gravada deixou de ser permitida (ex.: o
   * valor caiu abaixo de R$ 500,00), volta ao padrão, zera `prazoDias`/`numeroParcelas` e avisa.
   * Orçamento emitido (fora de rascunho) nunca é alterado.
   */
  private async aplicarCondicaoPadrao(
    orcamento: Orcamento,
    autor: Sessao,
    reverterInvalida: boolean,
  ): Promise<{ orcamento: Orcamento; avisos: AvisoDoOrcamento[] }> {
    const semMudanca = { orcamento, avisos: [] };
    if (!STATUS_DE_RASCUNHO.has(orcamento.status)) {
      return semMudanca;
    }
    const atual = orcamento.condicaoPagamento;
    // Com condição gravada, só se confere quando é para reverter uma que ficou inválida.
    if (atual !== null && !reverterInvalida) {
      return semMudanca;
    }
    const itens = await this.orcamentos.listarItens(orcamento.idOrcamento);
    const valorTotalItens = itens.reduce((total, item) => total + item.valorTotalItem, 0);
    const creditoAprovado = orcamento.primeiraCompra
      ? null
      : (await obterSituacaoCliente(this.proxy, orcamento.idCliente, 0, OPERACAO_SITUACAO_CLIENTE))
          .creditoAprovado;
    const resultadoCredito =
      creditoAprovado === null ? null : creditoAprovado ? 'APROVADO' : 'REPROVADO';
    if (atual !== null) {
      const permitidas = listarCondicoesPermitidas({
        valorTotalItens,
        primeiraCompra: orcamento.primeiraCompra,
        resultadoCredito,
      });
      if ((permitidas as readonly string[]).includes(atual)) {
        return semMudanca;
      }
    }
    const padrao = escolherCondicaoPadrao({
      primeiraCompra: orcamento.primeiraCompra,
      resultadoCredito,
    });
    await this.orcamentos.atualizarCondicoes(
      orcamento.idOrcamento,
      {
        condicaoPagamento: padrao,
        prazoDias: null,
        numeroParcelas: null,
        modalidadeFrete: orcamento.modalidadeFrete,
        origemTransportadora: orcamento.origemTransportadora,
        transportadora: orcamento.transportadora,
        valorFrete: orcamento.valorFrete,
        freteProvisorio: orcamento.freteProvisorio,
        valorTotalProposta: orcamento.valorTotalProposta,
      },
      this.agora(),
      // Ajuste do sistema, não edição do operador: não mexe em `id_operador_ultima_edicao`.
      null,
    );
    const trocado: Orcamento = {
      ...orcamento,
      condicaoPagamento: padrao,
      prazoDias: null,
      numeroParcelas: null,
    };
    if (atual === null) {
      return { orcamento: trocado, avisos: [] };
    }
    this.logger.info({
      evento: 'orcamento_condicao_trocada_automaticamente',
      idOrcamento: orcamento.idOrcamento,
      de: atual,
      para: padrao,
    });
    const rotulo = (condicao: string): string => ROTULO_DA_CONDICAO[condicao] ?? condicao;
    return {
      orcamento: trocado,
      avisos: [
        {
          codigo: 'CONDICAO_TROCADA_AUTOMATICAMENTE',
          mensagem: `A condição de pagamento (${rotulo(atual)}) deixou de estar disponível para este orçamento e foi trocada para ${rotulo(padrao)}. Confira antes de emitir.`,
        },
      ],
    };
  }

  /**
   * Operador a gravar em `id_operador_ultima_edicao`: só em RASCUNHO e PENDENTE_CREDITO, os únicos
   * status em que o banco aceita editar (orçamento emitido é imutável); fora deles, `null` omite.
   */
  private editorDoRascunho(orcamento: Orcamento, autor: Sessao): number | null {
    return STATUS_DE_RASCUNHO.has(orcamento.status) ? autor.idOperador : null;
  }

  /** Recalcula os totais e registra `idOperadorEdicao` como último editor, se ainda for rascunho. */
  private async recalcularTotais(idOrcamento: number, idOperadorEdicao: number): Promise<void> {
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
      orcamento !== null && STATUS_DE_RASCUNHO.has(orcamento.status) ? idOperadorEdicao : null,
    );
  }

  private async mudarStatus(
    idOrcamento: number,
    statusAnterior: StatusDoOrcamento,
    statusNovo: StatusDoOrcamento,
    autor: Sessao,
    observacao: string | null,
  ): Promise<void> {
    await this.orcamentos.atualizarStatus(idOrcamento, statusNovo, this.agora());
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
    const adiantada =
      escolha.condicaoPagamento === 'ADIANTADO_100' ||
      escolha.condicaoPagamento === 'ADIANTADO_50_50';
    if (adiantada && !primeiraCompra) {
      // Adiantado não exige crédito, prazo nem parcelas: não passa por `validarCondicaoFaturamento`
      // (que só trata boleto e parcelado); basta estar entre as permitidas.
      const condicao = escolha.condicaoPagamento as 'ADIANTADO_100' | 'ADIANTADO_50_50';
      const permitidas = listarCondicoesPermitidas({
        valorTotalItens,
        primeiraCompra,
        resultadoCredito:
          resultadoCredito === null ? null : resultadoCredito ? 'APROVADO' : 'REPROVADO',
      });
      if (!permitidas.includes(condicao)) {
        throw new ErroDeValidacao({
          causa: new Error(`condição ${condicao} não disponível para este orçamento`),
        });
      }
      return {
        ok: true,
        condicao,
        prazoDias: null,
        numeroParcelas: null,
        valorParcela: null,
        exigeAnaliseCredito: false,
      };
    }
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

  /** UC14-E1/E2: cliente inativo, bloqueado ou com dívida em aberto não abre orçamento. */
  private async exigirClienteLiberado(idCliente: number): Promise<void> {
    const cliente = await this.clientes.buscarPorId(idCliente);
    if (!cliente) {
      throw new ErroDeClienteNaoEncontrado();
    }
    if (cliente.status === 'INATIVO') {
      throw new ErroDeClienteBloqueado(
        'Este cliente está inativo. Não é possível abrir um orçamento para ele.',
      );
    }
    if (cliente.status === 'BLOQUEADO') {
      throw new ErroDeClienteBloqueado(
        'Este cliente está bloqueado. Não é possível abrir um orçamento para ele.',
      );
    }
    if ((await this.clientes.somarDividaEmAberto(idCliente)) > 0) {
      throw new ErroDeClienteBloqueado(
        'Este cliente tem dívida em aberto. Só é possível abrir um orçamento depois da renegociação (pagamento de no mínimo 50% do valor devido).',
      );
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

  /**
   * Repositórios e proxy que agrupam as leituras de cada rodada em um só `dados.lote` (RNF03): o
   * detalhe do orçamento lê muitas tabelas, e cada leitura avulsa seria uma ida ao proxy.
   */
  private leitoresEmLote() {
    const proxy = new LeitorEmLote(this.proxy, OPERACAO_DETALHE);
    return {
      proxy,
      orcamentos: new RepositorioDeOrcamentos(proxy),
      clientes: new RepositorioDeClientes(proxy),
      produtos: new RepositorioDeProdutos(proxy),
      usuarios: new RepositorioDeUsuarios(proxy),
    };
  }

  /**
   * Lê o que as condições comerciais e os bloqueios precisam: itens, cliente, dívida, crédito e
   * estoque. São três rodadas de leitura (itens e cliente; variações e reservas; produtos e
   * reservas), qualquer que seja o número de itens.
   */
  private async carregarBaseDasCondicoes(
    orcamento: Orcamento,
    leitores: ReturnType<ServicoDeOrcamentos['leitoresEmLote']>,
  ): Promise<BaseDasCondicoes> {
    // Cada leitura segue assim que o que ela precisa chegar, sem esperar as outras: é isso que
    // mantém as rodadas do lote em três.
    const itensEEstoque = leitores.orcamentos
      .listarItens(orcamento.idOrcamento)
      .then(async (itensDoOrcamento) => {
        const idsDasVariacoes = [...new Set(itensDoOrcamento.map((item) => item.idVariacao))];
        const temFardo = itensDoOrcamento.some((item) => item.granularidade === 'FARDO');
        const [variacoes, reservas, unidadesDosFardos] = await Promise.all([
          leitores.produtos.buscarVariacoesPorId(idsDasVariacoes),
          somarReservasPorVariacao(leitores.proxy, idsDasVariacoes, OPERACAO_SALDO_ITEM),
          temFardo
            ? leitores.produtos.buscarUnidadesDosFardos(idsDasVariacoes)
            : Promise.resolve(new Map<number, number>()),
        ]);
        return { itensDoOrcamento, variacoes, reservas, unidadesDosFardos };
      });
    const [
      { itensDoOrcamento, variacoes, reservas, unidadesDosFardos },
      cliente,
      dividaEmAberto,
      situacao,
    ] = await Promise.all([
      itensEEstoque,
      leitores.clientes.buscarPorId(orcamento.idCliente),
      leitores.clientes.somarDividaEmAberto(orcamento.idCliente),
      obterSituacaoCliente(leitores.proxy, orcamento.idCliente, 0, OPERACAO_SITUACAO_CLIENTE),
    ]);
    return {
      itensDoOrcamento,
      cliente,
      dividaEmAberto,
      creditoAprovado: situacao.creditoAprovado,
      variacoes,
      reservas,
      unidadesDosFardos,
    };
  }

  /** Bloqueios e condições comerciais, sempre ao vivo, a partir do que `carregarBase...` leu. */
  private avaliarCondicoes(orcamento: Orcamento, base: BaseDasCondicoes): CondicoesComerciais {
    const {
      itensDoOrcamento,
      cliente,
      dividaEmAberto,
      creditoAprovado,
      variacoes,
      reservas,
      unidadesDosFardos,
    } = base;
    const valorTotalItens = itensDoOrcamento.reduce(
      (total, item) => total + item.valorTotalItem,
      0,
    );
    const bloqueios: BloqueioDeEmissao[] = [];
    if (itensDoOrcamento.length === 0) {
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
    if (orcamento.condicaoPagamento === null || orcamento.modalidadeFrete === null) {
      // O banco só emite com condição de pagamento e frete definidos (UC18); avisar aqui evita
      // que o operador descubra pela falha da emissão.
      bloqueios.push({
        codigo: 'CONDICOES_INCOMPLETAS',
        mensagem: 'Defina a condição de pagamento e o frete antes de emitir.',
      });
    }
    if (orcamento.modalidadeFrete === 'FOB' && orcamento.freteProvisorio) {
      // O banco recusa a emissão com frete provisório (FRETE_PROVISORIO_NAO_EMITIVEL); avisar
      // antes evita que o operador descubra pela falha da emissão (UC18-E3).
      bloqueios.push({
        codigo: 'FRETE_PROVISORIO',
        mensagem:
          'O frete ainda não foi cotado com a transportadora. Informe o valor do frete antes de emitir.',
      });
    }
    const resultadoDoCredito =
      creditoAprovado === null ? null : creditoAprovado ? 'APROVADO' : 'REPROVADO';
    let creditoStatus: CondicoesComerciais['creditoStatus'] = 'NAO_EXIGIDO';
    if (
      !orcamento.primeiraCompra &&
      (orcamento.condicaoPagamento === 'BOLETO' || orcamento.condicaoPagamento === 'PARCELADO')
    ) {
      if (creditoAprovado === null) {
        creditoStatus = 'PENDENTE';
        bloqueios.push({
          codigo: 'PENDENTE_CREDITO',
          mensagem: 'A análise de crédito ainda não foi concluída.',
        });
      } else {
        creditoStatus = creditoAprovado ? 'APROVADO' : 'REPROVADO';
      }
    }
    // As regras de valor e de condição vêm do módulo de cálculo (UC18); aqui só viram texto.
    const condicoesPermitidas = listarCondicoesPermitidas({
      valorTotalItens,
      primeiraCompra: orcamento.primeiraCompra,
      resultadoCredito: resultadoDoCredito,
    });
    const faltaParaOMinimo = calcularFaltaParaFaturamentoMinimo({
      valorTotalItens,
      primeiraCompra: orcamento.primeiraCompra,
    });
    if (valorTotalItens > 0 && faltaParaOMinimo > 0) {
      bloqueios.push({
        codigo: 'ABAIXO_DO_MINIMO',
        mensagem: `Abaixo do faturamento mínimo de ${formatarReais(FATURAMENTO_MINIMO)} – faltam ${formatarReais(faltaParaOMinimo)}`,
      });
    }
    if (
      orcamento.condicaoPagamento !== null &&
      !(condicoesPermitidas as readonly string[]).includes(orcamento.condicaoPagamento)
    ) {
      const rotulo = ROTULO_DA_CONDICAO[orcamento.condicaoPagamento] ?? orcamento.condicaoPagamento;
      const opcoes = condicoesPermitidas
        .map((condicao) => ROTULO_DA_CONDICAO[condicao] ?? condicao)
        .join(', ');
      bloqueios.push({
        codigo: 'CONDICAO_NAO_PERMITIDA',
        mensagem: `A condição de pagamento escolhida (${rotulo}) não está disponível para este orçamento. Escolha uma destas: ${opcoes}.`,
      });
    }
    const variacaoPorId = new Map(variacoes.map((variacao) => [variacao.idVariacao, variacao]));
    for (const item of itensDoOrcamento) {
      const variacao = variacaoPorId.get(item.idVariacao);
      const saldo = calcularSaldoDisponivel(
        variacao?.quantidadeEstoque ?? 0,
        reservas.get(item.idVariacao) ?? 0,
      );
      const solicitado =
        item.granularidade === 'FARDO'
          ? (item.quantidadeFardos ?? 0)
          : (item.quantidadeAvulsa ?? 0);
      const unidadesPorFardo =
        item.idFardo === null ? undefined : unidadesDosFardos.get(item.idFardo);
      if (solicitado <= 0 || (item.granularidade === 'FARDO' && unidadesPorFardo === undefined)) {
        continue;
      }
      const estoque = validarDisponibilidadeEstoque({
        saldoDisponivel: saldo,
        quantidadeSolicitada: solicitado,
        granularidade: item.granularidade,
        unidadesPorFardo,
      });
      if (!estoque.ok) {
        // Texto do UC19-E5.
        bloqueios.push({
          codigo: 'ESTOQUE_INSUFICIENTE',
          mensagem: `Estoque insuficiente para emitir: ${variacao?.descricaoDoProduto ?? 'produto'}. Disponível: ${estoque.maximoDisponivel}; no orçamento: ${solicitado}. Ajuste a quantidade ou remova o item.`,
        });
      }
    }
    return {
      valorTotalItens,
      valorTotalImposto: itensDoOrcamento.reduce((total, item) => total + item.valorImposto, 0),
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
      avisos: [],
    };
  }

  private async montarDetalhe(
    orcamento: Orcamento,
    avisos: readonly AvisoDoOrcamento[] = [],
  ): Promise<OrcamentoDetalhado> {
    const leitores = this.leitoresEmLote();
    // Tudo é pedido junto: as leituras independentes caem na mesma rodada do lote.
    const [base, complementos] = await Promise.all([
      this.carregarBaseDasCondicoes(orcamento, leitores),
      Promise.all([
        leitores.orcamentos.listarHistorico(orcamento.idOrcamento),
        leitores.orcamentos.listarVersoes(orcamento),
        leitores.orcamentos.listarAnexos(orcamento.idOrcamento),
      ]).then(async ([historico, versoes, anexos]) => {
        const nomes = await this.nomesDosOperadores(
          [
            orcamento.idOperador,
            orcamento.idOperadorUltimaEdicao,
            ...historico.map((evento) => evento.idOperador),
          ],
          leitores.usuarios,
        );
        return {
          historicoDetalhado: this.detalharHistorico(historico, nomes),
          responsavel: {
            idOperador: orcamento.idOperador,
            nome: nomes.get(orcamento.idOperador) ?? '',
          },
          ultimaAlteracaoDeOutro: this.ultimaAlteracaoDeOutro(orcamento, historico, nomes),
          versoes,
          anexosDoOrcamento: anexos,
        };
      }),
    ]);
    const { cliente } = base;
    const { historicoDetalhado, versoes, anexosDoOrcamento, responsavel, ultimaAlteracaoDeOutro } =
      complementos;
    const itens = this.detalharItens(base.itensDoOrcamento, base.variacoes);
    const condicoes = { ...this.avaliarCondicoes(orcamento, base), avisos };
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
      responsavel,
      ultimaAlteracaoDeOutro,
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
      anexos: anexosDoOrcamento.map((anexo) => ({
        idAnexo: anexo.idAnexo,
        tipoAnexo: anexo.tipoAnexo,
        nomeArquivo: anexo.nomeArquivo,
      })),
      condicoes,
      historico: historicoDetalhado,
      versoes: versoes.map((versao) => ({
        idOrcamento: versao.idOrcamento,
        numeroOrcamento: versao.numeroOrcamento,
        status: versao.status,
      })),
    };
  }

  /** Nome de usuário (login) de cada id, para exibição (UC06, aviso de edição de rascunho). */
  private async nomesDosOperadores(
    ids: readonly (number | null)[],
    usuarios: RepositorioDeUsuarios,
  ): Promise<Map<number, string>> {
    const unicos = [...new Set(ids.filter((id): id is number => id !== null))];
    const encontrados = await Promise.all(unicos.map((id) => usuarios.buscarPorId(id)));
    return new Map(
      encontrados
        .filter((usuario): usuario is NonNullable<typeof usuario> => usuario !== null)
        .map((usuario) => [usuario.idOperador, usuario.usuario]),
    );
  }

  private detalharHistorico(
    eventos: readonly EventoDoHistorico[],
    nomesPorId: ReadonlyMap<number, string>,
  ): EventoDeHistoricoDetalhado[] {
    return eventos.map((evento) => ({
      tipoEvento: evento.tipoEvento,
      statusAnterior: evento.statusAnterior,
      statusNovo: evento.statusNovo,
      observacao: evento.observacao,
      usuario: evento.idOperador === null ? null : (nomesPorId.get(evento.idOperador) ?? null),
      dataRegistro: evento.dataRegistro,
    }));
  }

  /**
   * Aviso de edição por outro operador (UC14). A coluna `id_operador_ultima_edicao` manda; só se
   * for nula (orçamento anterior à coluna) vale o evento mais recente do histórico de outro operador.
   */
  private ultimaAlteracaoDeOutro(
    orcamento: Orcamento,
    eventos: readonly EventoDoHistorico[],
    nomesPorId: ReadonlyMap<number, string>,
  ): AlteracaoDeOutroOperador | null {
    const idResponsavel = orcamento.idOperador;
    const idEditor = orcamento.idOperadorUltimaEdicao;
    if (idEditor !== null) {
      return idEditor === idResponsavel
        ? null
        : {
            idOperador: idEditor,
            nome: nomesPorId.get(idEditor) ?? '',
            data: orcamento.dataUltimaEdicao,
          };
    }
    let ultimo: { idOperador: number; data: string } | null = null;
    for (const evento of eventos) {
      if (evento.idOperador === null || evento.idOperador === idResponsavel) continue;
      if (ultimo === null || evento.dataRegistro > ultimo.data) {
        ultimo = { idOperador: evento.idOperador, data: evento.dataRegistro };
      }
    }
    return ultimo === null ? null : { ...ultimo, nome: nomesPorId.get(ultimo.idOperador) ?? '' };
  }

  private detalharItens(
    itens: readonly ItemDoOrcamento[],
    variacoes: readonly VariacaoComProduto[],
  ): ItemDetalhado[] {
    const porId = new Map(variacoes.map((variacao) => [variacao.idVariacao, variacao]));
    return itens.map((item) => {
      const variacao = porId.get(item.idVariacao);
      return {
        idItem: item.idItem,
        idVariacao: item.idVariacao,
        produto: variacao?.descricaoDoProduto ?? '',
        codigoInterno: variacao?.codigoInternoDoProduto ?? '',
        ncm: variacao?.ncmDoProduto ?? null,
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
