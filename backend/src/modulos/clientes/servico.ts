// UC02 e UC03 — cadastro de cliente com consentimento LGPD e consulta por CNPJ (RF03, RF04, RF20).
import {
  ErroDeClienteJaCadastrado,
  ErroDeClienteNaoEncontrado,
  ErroDeValidacao,
  ErroInterno,
} from '../../erros';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import { PERFIL_VENDEDOR, STATUS_ATIVO, type RepositorioDeUsuarios } from '../usuarios/repositorio';
import type { DadosDoClienteNovo } from './esquemas';
import type {
  ClienteCadastrado,
  EnderecoDoCliente,
  RepositorioDeClientes,
  StatusDoCliente,
  TipoDeUnidade,
} from './repositorio';

const CAMPO_VENDEDOR = 'idOperadorVendedor';
const MENSAGEM_VENDEDOR_INVALIDO =
  'O vendedor responsável deve ser um usuário ativo com perfil de vendedor.';

/** Ficha do cliente. É o tipo `ClienteFicha` de `frontend/src/api/types.ts`. */
export interface ClienteFicha {
  readonly idCliente: number;
  readonly cnpj: string;
  readonly razaoSocial: string;
  readonly nomeContato: string;
  readonly telefoneContato: string | null;
  readonly emailContato: string | null;
  readonly tipoUnidade: TipoDeUnidade;
  readonly status: StatusDoCliente;
  /** Nome de usuário do vendedor dono da carteira. */
  readonly vendedorResponsavel: string;
  readonly enderecos: readonly EnderecoDoCliente[];
  /** Em centavos. Maior que zero bloqueia novos orçamentos (RN06). */
  readonly dividaEmAberto: number;
}

/** Opção do campo "vendedor responsável". É o tipo `VendedorOpcao` do frontend. */
export interface VendedorOpcao {
  readonly idOperador: number;
  /** A tabela `operador` não tem coluna de nome: repete o nome de usuário. */
  readonly nome: string;
}

/** Um orçamento em aberto do cliente, na forma resumida de `OrcamentoResumo` do frontend. */
export interface OrcamentoEmAbertoDoCliente {
  readonly idOrcamento: number;
  readonly numeroOrcamento: number | null;
  readonly idCliente: number;
  readonly cliente: string;
  readonly cnpj: string;
  readonly dataEmissao: string | null;
  readonly dataValidade: string | null;
  readonly diasParaVencer: number | null;
  readonly valorTotalProposta: number | null;
  readonly status: string;
}

/** Uma compra fechada do cliente (orçamento ACEITO). É o tipo `HistoricoCompra` do frontend. */
export interface HistoricoDeCompraDoCliente {
  readonly idOrcamento: number;
  readonly numeroOrcamento: number;
  readonly dataEmissao: string;
  readonly valorTotalAceito: number;
}

/**
 * Leitura dos orçamentos do cliente, para a ficha (RF04). Definida aqui (e não no módulo de
 * orçamentos) para `clientes` não precisar importar `orcamentos`; `app.ts` liga a implementação
 * real (`ServicoDeOrcamentos`), do mesmo jeito que `pedidos` recebe o `MontadorDeOrcamentos`.
 */
export interface LeitorDeOrcamentosDoCliente {
  listarEmAberto(idCliente: number): Promise<readonly OrcamentoEmAbertoDoCliente[]>;
  listarHistoricoDeCompras(idCliente: number): Promise<readonly HistoricoDeCompraDoCliente[]>;
}

export interface DependenciasDoServicoDeClientes {
  readonly clientes: RepositorioDeClientes;
  /** Para conferir e listar os vendedores. */
  readonly usuarios: RepositorioDeUsuarios;
  /** Orçamentos em aberto e histórico de compras do cliente (RF04); ver {@link LeitorDeOrcamentosDoCliente}. */
  readonly orcamentos: LeitorDeOrcamentosDoCliente;
  readonly logger: Logger;
  /** Relógio; por padrão, a hora do sistema. */
  readonly agora?: () => Date;
}

/** Regras do cadastro e da consulta de clientes (UC02, UC03). */
export class ServicoDeClientes {
  private readonly clientes: RepositorioDeClientes;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly orcamentos: LeitorDeOrcamentosDoCliente;
  private readonly logger: Logger;
  private readonly agora: () => Date;

  constructor(dependencias: DependenciasDoServicoDeClientes) {
    this.clientes = dependencias.clientes;
    this.usuarios = dependencias.usuarios;
    this.orcamentos = dependencias.orcamentos;
    this.logger = dependencias.logger;
    this.agora = dependencias.agora ?? (() => new Date());
  }

  /**
   * Ficha do cliente com o CNPJ informado (14 dígitos).
   *
   * @throws {ErroDeClienteNaoEncontrado} Se o CNPJ não estiver cadastrado (UC03-E1).
   */
  async buscarFichaPorCnpj(cnpj: string): Promise<ClienteFicha> {
    const cliente = await this.clientes.buscarPorCnpj(cnpj);
    if (!cliente) {
      throw new ErroDeClienteNaoEncontrado();
    }
    return this.montarFicha(cliente);
  }

  /**
   * Cadastra o cliente com seus endereços e registra o momento do aceite da cláusula LGPD.
   *
   * @param autor Operador que fez o cadastro.
   * @throws {ErroDeClienteJaCadastrado} Se o CNPJ já pertencer a outro cliente.
   * @throws {ErroDeValidacao} Se o vendedor responsável não for um vendedor ativo.
   */
  async cadastrar(dados: DadosDoClienteNovo, autor: Sessao): Promise<ClienteFicha> {
    if (await this.clientes.buscarPorCnpj(dados.cnpj)) {
      throw new ErroDeClienteJaCadastrado();
    }
    const vendedor = await this.usuarios.buscarPorId(dados.idOperadorVendedor);
    if (vendedor?.perfil !== PERFIL_VENDEDOR || vendedor.status !== STATUS_ATIVO) {
      throw new ErroDeValidacao({
        mensagem: MENSAGEM_VENDEDOR_INVALIDO,
        detalhes: { campos: [CAMPO_VENDEDOR] },
      });
    }
    const idCliente = await this.inserir(dados);
    // O log identifica o cadastro pelo id: CNPJ e dados de contato ficam fora dele (LGPD).
    this.logger.info(
      { evento: 'cliente_cadastrado', idCliente, idAutor: autor.idOperador },
      'Cliente cadastrado.',
    );
    return this.buscarFichaPorCnpj(dados.cnpj);
  }

  /** Vendedores ativos, para o campo "vendedor responsável" do cadastro. */
  async listarVendedores(): Promise<VendedorOpcao[]> {
    const vendedores = await this.usuarios.listarVendedoresAtivos();
    return vendedores.map(({ idOperador, usuario }) => ({ idOperador, nome: usuario }));
  }

  /** Orçamentos em aberto do cliente (RF04): ainda em elaboração ou aguardando o cliente. */
  listarOrcamentosEmAberto(idCliente: number): Promise<readonly OrcamentoEmAbertoDoCliente[]> {
    return this.orcamentos.listarEmAberto(idCliente);
  }

  /**
   * Histórico de compras do cliente (RF04, RF07): orçamentos ACEITO.
   *
   * TODO item 7: `valorTotalAceito` repete o valor total proposto, porque o valor efetivamente
   * aceito item a item só existe a partir de `resposta_orcamento`/`item_resposta_orcamento`
   * (UC20/21), que ainda não foram implementados.
   */
  listarHistoricoDeCompras(idCliente: number): Promise<readonly HistoricoDeCompraDoCliente[]> {
    return this.orcamentos.listarHistoricoDeCompras(idCliente);
  }

  /**
   * Grava o cliente. Se a gravação falhar porque o mesmo CNPJ foi cadastrado ao mesmo tempo por
   * outra requisição, o erro vira o mesmo conflito da conferência inicial.
   */
  private async inserir(dados: DadosDoClienteNovo): Promise<number> {
    try {
      return await this.clientes.inserir(dados, this.agora());
    } catch (erro) {
      if (await this.clientes.buscarPorCnpj(dados.cnpj)) {
        throw new ErroDeClienteJaCadastrado();
      }
      throw erro;
    }
  }

  private async montarFicha(cliente: ClienteCadastrado): Promise<ClienteFicha> {
    const [vendedor, dividaEmAberto] = await Promise.all([
      this.usuarios.buscarPorId(cliente.idOperadorVendedor),
      this.clientes.somarDividaEmAberto(cliente.idCliente),
    ]);
    if (!vendedor) {
      throw new ErroInterno(new Error(`Cliente ${cliente.idCliente} sem vendedor responsável.`));
    }
    return {
      idCliente: cliente.idCliente,
      cnpj: cliente.cnpj,
      razaoSocial: cliente.razaoSocial,
      nomeContato: cliente.nomeContato,
      telefoneContato: cliente.telefoneContato,
      emailContato: cliente.emailContato,
      tipoUnidade: cliente.tipoUnidade,
      status: cliente.status,
      vendedorResponsavel: vendedor.usuario,
      enderecos: cliente.enderecos,
      dividaEmAberto,
    };
  }
}
