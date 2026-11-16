// UC10 — fila de pedidos do Sistema 1: assumir, consultar, negar ou montar o orçamento.
import { z } from 'zod';
import { consultar, validarLinha, type ClienteDeProxy } from '../../dados';
import { ErroDePedidoNaoAssumidoPorVoce, ErroDePedidoNaoEncontrado } from '../../erros';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import type { RepositorioDeClientes } from '../clientes/repositorio';
import { calcularSaldoDisponivel, somarReservasPorVariacao } from '../comum/estoque';
import { obterSituacaoCliente, type SituacaoCliente } from '../comum/situacaoCliente';
import type { RepositorioDeProdutos, VariacaoComProduto } from '../produtos/repositorio';
import type { RepositorioDeUsuarios, UsuarioCadastrado } from '../usuarios/repositorio';
import type {
  Granularidade,
  ItemDePedido,
  Pedido,
  RepositorioDePedidos,
  StatusDoPedido,
} from './repositorio';

/** Prefixo de exibição do número do pedido (`id_pedido` não tem coluna própria de numeração). */
const PREFIXO_DO_NUMERO = 'PED-';
const DIGITOS_DO_NUMERO = 4;
const OPERACAO_SITUACAO_CLIENTE = 'UC10-situacao-cliente';

/** Linha da fila de pedidos. É o tipo `PedidoResumo` do frontend. */
export interface PedidoResumo {
  readonly idPedido: number;
  readonly numero: string;
  readonly idCliente: number;
  readonly cliente: string;
  readonly cnpj: string;
  readonly vendedor: string;
  readonly dataSolicitacao: string;
  readonly quantidadeItens: number;
  readonly status: StatusDoPedido;
  readonly operadorAtendimento: string | null;
  readonly assumidoPorOutro: boolean;
}

/** Item do pedido com o saldo de estoque disponível. É o tipo `PedidoItem` do frontend. */
export interface PedidoItemDetalhado {
  readonly idItemPedido: number;
  readonly produto: string;
  readonly marca: string;
  readonly embalagem: string;
  readonly granularidade: Granularidade;
  readonly quantidadeSolicitada: number;
  readonly saldoDisponivel: number;
}

/** Detalhe completo do pedido (tela 3). É o tipo `PedidoDetalhe` do frontend. */
export interface PedidoDetalhado extends PedidoResumo {
  readonly itens: readonly PedidoItemDetalhado[];
  readonly enderecoEntrega: string | null;
  readonly numeroSolicitacaoCompra: string | null;
  readonly contato: string | null;
  readonly condicaoPagamentoDesejada: string | null;
  readonly prazoDiasDesejado: number | null;
  readonly numeroParcelasDesejado: number | null;
  readonly transportadoraIndicada: string | null;
  readonly observacoes: string | null;
  readonly situacaoCliente: SituacaoCliente;
}

/** Os quatro indicadores da tela 2. É o tipo `IndicadoresPedidos` do frontend. */
export interface IndicadoresDaFila {
  readonly aguardandoAnalise: number;
  readonly emAnalise: number;
  readonly orcamentosEmAberto: number;
  readonly pendentesCredito: number;
}

/** Fila de pedidos com os indicadores (resposta de `GET /pedidos`). */
export interface FilaDePedidos {
  readonly itens: readonly PedidoResumo[];
  readonly indicadores: IndicadoresDaFila;
}

/**
 * Monta o orçamento em RASCUNHO a partir de um pedido aprovado (UC10 → UC14). Implementado pelo
 * módulo de orçamentos; injetado aqui para `pedidos` não depender de `orcamentos` em tempo de
 * import (só na montagem do app, em `http/app.ts`).
 */
export interface MontadorDeOrcamentos {
  montarAPartirDoPedido(
    pedido: Pedido,
    itens: readonly ItemDePedido[],
    autor: Sessao,
  ): Promise<number>;
}

export interface DependenciasDoServicoDePedidos {
  readonly pedidos: RepositorioDePedidos;
  readonly clientes: RepositorioDeClientes;
  readonly produtos: RepositorioDeProdutos;
  readonly usuarios: RepositorioDeUsuarios;
  readonly proxy: ClienteDeProxy;
  readonly orcamentos: MontadorDeOrcamentos;
  readonly logger: Logger;
  readonly agora?: () => Date;
}

/** Regras da fila de pedidos (UC10). */
export class ServicoDePedidos {
  private readonly pedidos: RepositorioDePedidos;
  private readonly clientes: RepositorioDeClientes;
  private readonly produtos: RepositorioDeProdutos;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly proxy: ClienteDeProxy;
  private readonly orcamentos: MontadorDeOrcamentos;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDePedidos) {
    this.pedidos = dependencias.pedidos;
    this.clientes = dependencias.clientes;
    this.produtos = dependencias.produtos;
    this.usuarios = dependencias.usuarios;
    this.proxy = dependencias.proxy;
    this.orcamentos = dependencias.orcamentos;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /** Fila de pedidos, com os quatro indicadores da tela 2. */
  async listarFila(sessao: Sessao, status?: StatusDoPedido): Promise<FilaDePedidos> {
    const [pedidos, indicadores] = await Promise.all([
      this.pedidos.listar(status),
      this.calcularIndicadores(),
    ]);
    const usuarios = await this.mapaDeUsuarios();
    const clientes = await this.mapaDeClientes(pedidos.map((pedido) => pedido.idCliente));
    const itensPorPedido = await this.contarItensPorPedido(
      pedidos.map((pedido) => pedido.idPedido),
    );
    const itens = pedidos.map((pedido) =>
      this.paraResumo(pedido, sessao, usuarios, clientes, itensPorPedido.get(pedido.idPedido) ?? 0),
    );
    return { itens, indicadores };
  }

  /**
   * Detalhe do pedido, com os itens e a situação de crédito do cliente.
   *
   * @throws {ErroDePedidoNaoEncontrado} Se o pedido não existir (404).
   */
  async obterDetalhe(idPedido: number, sessao: Sessao): Promise<PedidoDetalhado> {
    const pedido = await this.buscarOuFalhar(idPedido);
    const [itensDoPedido, usuarios, cliente] = await Promise.all([
      this.pedidos.listarItens(idPedido),
      this.mapaDeUsuarios(),
      this.clientes.buscarPorId(pedido.idCliente),
    ]);
    const resumo = this.paraResumo(
      pedido,
      sessao,
      usuarios,
      cliente ? new Map([[cliente.idCliente, cliente]]) : new Map(),
      itensDoPedido.length,
    );
    const itens = await this.detalharItens(itensDoPedido);
    const dividaEmAberto = await this.clientes.somarDividaEmAberto(pedido.idCliente);
    const situacaoCliente = await obterSituacaoCliente(
      this.proxy,
      pedido.idCliente,
      dividaEmAberto,
      OPERACAO_SITUACAO_CLIENTE,
    );
    const enderecoEntrega =
      pedido.idEnderecoEntrega === null
        ? null
        : this.formatarEndereco(cliente?.enderecos ?? [], pedido.idEnderecoEntrega);
    return {
      ...resumo,
      itens,
      enderecoEntrega,
      numeroSolicitacaoCompra: pedido.numeroSolicitacaoCompra,
      contato: pedido.contatoSolicitacao,
      condicaoPagamentoDesejada: pedido.condicaoPagamentoDesejada,
      prazoDiasDesejado: pedido.prazoDiasDesejado,
      numeroParcelasDesejado: pedido.numeroParcelasDesejado,
      transportadoraIndicada: pedido.transportadoraIndicada,
      observacoes: pedido.observacoes,
      situacaoCliente,
    };
  }

  /**
   * Assume o pedido para análise (SOLICITADO → EM_ANALISE).
   *
   * @throws {ErroDePedidoNaoEncontrado} Se o pedido não existir (404).
   * @throws {ErroDePedidoJaAssumido} Se outro operador chegou antes (409, UC10-E1).
   */
  async assumir(idPedido: number, sessao: Sessao): Promise<PedidoDetalhado> {
    await this.buscarOuFalhar(idPedido);
    await this.pedidos.assumir(idPedido, sessao.idOperador);
    this.logger.info(
      { evento: 'pedido_assumido', idPedido, idOperador: sessao.idOperador },
      'Pedido assumido para análise.',
    );
    return this.obterDetalhe(idPedido, sessao);
  }

  /**
   * Nega o pedido com o motivo informado.
   *
   * @throws {ErroDePedidoNaoEncontrado} Se o pedido não existir (404).
   * @throws {ErroDePedidoNaoAssumidoPorVoce} Se a sessão não assumiu o pedido antes (409).
   */
  async negar(idPedido: number, motivo: string, sessao: Sessao): Promise<void> {
    const pedido = await this.buscarOuFalhar(idPedido);
    this.exigirAssumidoPelaSessao(pedido, sessao);
    await this.pedidos.negar(idPedido, motivo, this.agora());
    this.logger.info(
      { evento: 'pedido_negado', idPedido, idOperador: sessao.idOperador },
      'Pedido negado.',
    );
  }

  /**
   * Cria o orçamento em RASCUNHO a partir do pedido (UC10 → UC14).
   *
   * @throws {ErroDePedidoNaoEncontrado} Se o pedido não existir (404).
   * @throws {ErroDePedidoNaoAssumidoPorVoce} Se a sessão não assumiu o pedido antes (409).
   */
  async montarOrcamento(idPedido: number, sessao: Sessao): Promise<{ idOrcamento: number }> {
    const pedido = await this.buscarOuFalhar(idPedido);
    this.exigirAssumidoPelaSessao(pedido, sessao);
    const itens = await this.pedidos.listarItens(idPedido);
    const idOrcamento = await this.orcamentos.montarAPartirDoPedido(pedido, itens, sessao);
    this.logger.info(
      {
        evento: 'orcamento_montado_de_pedido',
        idPedido,
        idOrcamento,
        idOperador: sessao.idOperador,
      },
      'Orçamento montado a partir do pedido.',
    );
    return { idOrcamento };
  }

  private async buscarOuFalhar(idPedido: number): Promise<Pedido> {
    const pedido = await this.pedidos.buscarPorId(idPedido);
    if (!pedido) {
      throw new ErroDePedidoNaoEncontrado();
    }
    return pedido;
  }

  private exigirAssumidoPelaSessao(pedido: Pedido, sessao: Sessao): void {
    if (pedido.status !== 'EM_ANALISE' || pedido.idOperadorAtendimento !== sessao.idOperador) {
      throw new ErroDePedidoNaoAssumidoPorVoce();
    }
  }

  private async calcularIndicadores(): Promise<IndicadoresDaFila> {
    const [aguardandoAnalise, emAnalise, orcamentosEmAberto, pendentesCredito] = await Promise.all([
      this.pedidos.contarPorStatus('SOLICITADO'),
      this.pedidos.contarPorStatus('EM_ANALISE'),
      this.contarOrcamentosPorStatus('ABERTO'),
      this.contarOrcamentosPorStatus('PENDENTE_CREDITO'),
    ]);
    return { aguardandoAnalise, emAnalise, orcamentosEmAberto, pendentesCredito };
  }

  private async contarOrcamentosPorStatus(status: string): Promise<number> {
    const [linha] = await consultar(
      this.proxy,
      {
        tabela: 'orcamento',
        filtros: { e: [['status', '=', status]] },
        agregacoes: [{ fn: 'contar', campo: '*', como: 'total' }],
      },
      'UC10-contar-orcamentos',
    );
    const { total } = validarLinha(z.object({ total: z.number().int() }), linha, 'orcamento');
    return total;
  }

  private async mapaDeUsuarios(): Promise<Map<number, UsuarioCadastrado>> {
    const usuarios = await this.usuarios.listar();
    return new Map(usuarios.map((usuario) => [usuario.idOperador, usuario]));
  }

  private async mapaDeClientes(
    idsDosClientes: readonly number[],
  ): Promise<Map<number, { razaoSocial: string; cnpj: string }>> {
    const unicos = [...new Set(idsDosClientes)];
    const clientes = await Promise.all(
      unicos.map((idCliente) => this.clientes.buscarPorId(idCliente)),
    );
    const mapa = new Map<number, { razaoSocial: string; cnpj: string }>();
    clientes.forEach((cliente, indice) => {
      if (cliente) {
        mapa.set(unicos[indice] as number, {
          razaoSocial: cliente.razaoSocial,
          cnpj: cliente.cnpj,
        });
      }
    });
    return mapa;
  }

  private async contarItensPorPedido(
    idsDosPedidos: readonly number[],
  ): Promise<Map<number, number>> {
    const contagens = new Map<number, number>();
    await Promise.all(
      idsDosPedidos.map(async (idPedido) => {
        const itens = await this.pedidos.listarItens(idPedido);
        contagens.set(idPedido, itens.length);
      }),
    );
    return contagens;
  }

  private paraResumo(
    pedido: Pedido,
    sessao: Sessao,
    usuarios: Map<number, UsuarioCadastrado>,
    clientes: Map<number, { razaoSocial: string; cnpj: string }>,
    quantidadeItens: number,
  ): PedidoResumo {
    const cliente = clientes.get(pedido.idCliente);
    const vendedor = usuarios.get(pedido.idOperadorVendedor);
    const operadorAtendimento =
      pedido.idOperadorAtendimento === null
        ? null
        : (usuarios.get(pedido.idOperadorAtendimento)?.usuario ?? null);
    return {
      idPedido: pedido.idPedido,
      numero: `${PREFIXO_DO_NUMERO}${String(pedido.idPedido).padStart(DIGITOS_DO_NUMERO, '0')}`,
      idCliente: pedido.idCliente,
      cliente: cliente?.razaoSocial ?? '',
      cnpj: cliente?.cnpj ?? '',
      vendedor: vendedor?.usuario ?? '',
      dataSolicitacao: pedido.dataSolicitacao,
      quantidadeItens,
      status: pedido.status,
      operadorAtendimento,
      assumidoPorOutro:
        pedido.status === 'EM_ANALISE' && pedido.idOperadorAtendimento !== sessao.idOperador,
    };
  }

  private async detalharItens(itens: readonly ItemDePedido[]): Promise<PedidoItemDetalhado[]> {
    const idsDasVariacoes = [...new Set(itens.map((item) => item.idVariacao))];
    const variacoes = await this.produtos.buscarVariacoesPorId(idsDasVariacoes);
    const saldos = await somarReservasPorVariacao(this.proxy, idsDasVariacoes, 'UC10-saldo-item');
    const porId = new Map<number, VariacaoComProduto>(
      variacoes.map((variacao) => [variacao.idVariacao, variacao]),
    );
    return itens.map((item) => {
      const variacao = porId.get(item.idVariacao);
      return {
        idItemPedido: item.idItemPedido,
        produto: variacao?.descricaoDoProduto ?? '',
        marca: variacao?.marca ?? '',
        embalagem: variacao?.tamanhoEmbalagem ?? '',
        granularidade: item.granularidade,
        quantidadeSolicitada: item.quantidadeSolicitada,
        saldoDisponivel: calcularSaldoDisponivel(
          variacao?.quantidadeEstoque ?? 0,
          saldos.get(item.idVariacao) ?? 0,
        ),
      };
    });
  }

  private formatarEndereco(
    enderecos: readonly {
      idEndereco: number;
      logradouro: string;
      numero: string;
      bairro: string;
      cidade: string;
      uf: string;
    }[],
    idEndereco: number,
  ): string | null {
    const endereco = enderecos.find((candidato) => candidato.idEndereco === idEndereco);
    if (!endereco) {
      return null;
    }
    return `${endereco.logradouro}, ${endereco.numero} - ${endereco.bairro}, ${endereco.cidade}/${endereco.uf}`;
  }
}
