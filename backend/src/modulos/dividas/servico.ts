// UC23 — regras de registro, renegociação e quitação de dívidas de inadimplência (RF25, RN06).
import {
  ErroDeDividaNaoEncontrada,
  ErroDeDividaNaoRenegociavel,
  ErroDeRenegociacaoAbaixoDoMinimo,
} from '../../erros';
import type { Logger } from '../../log';
import type { RepositorioDeClientes } from '../clientes/repositorio';
import type { Sessao } from '../auth/sessoes';
import type { DadosDaDividaNova, DadosDaRenegociacao } from './esquemas';
import {
  FRACAO_MINIMA_DA_RENEGOCIACAO,
  type Divida,
  type RepositorioDeDividas,
} from './repositorio';

/** A dívida como a tela exibe (`Divida` do frontend), com o nome do cliente já resolvido. */
export interface DividaDetalhada extends Divida {
  readonly cliente: string;
}

export interface DependenciasDoServicoDeDividas {
  readonly dividas: RepositorioDeDividas;
  readonly clientes: RepositorioDeClientes;
  readonly logger: Logger;
}

/** Regras de negócio das dívidas de inadimplência (UC23). */
export class ServicoDeDividas {
  private readonly dividas: RepositorioDeDividas;
  private readonly clientes: RepositorioDeClientes;
  private readonly logger: Logger;

  constructor(dependencias: DependenciasDoServicoDeDividas) {
    this.dividas = dependencias.dividas;
    this.clientes = dependencias.clientes;
    this.logger = dependencias.logger;
  }

  /** Todas as dívidas, com o nome do cliente. */
  async listar(): Promise<DividaDetalhada[]> {
    const dividas = await this.dividas.listar();
    return this.comNomeDoCliente(dividas);
  }

  /** Registra a dívida (passo 2 da UC23); a partir daqui o cliente fica bloqueado (RN06). */
  async registrar(dados: DadosDaDividaNova, autor: Sessao): Promise<DividaDetalhada> {
    const divida = await this.dividas.inserir(dados, autor.idOperador);
    this.logger.info(
      { evento: 'divida_registrada', idDivida: divida.idDivida, idAutor: autor.idOperador },
      'Dívida registrada.',
    );
    const [detalhada] = await this.comNomeDoCliente([divida]);
    return detalhada as DividaDetalhada;
  }

  /**
   * Renegocia a dívida (passo 4 da UC23): exige pelo menos 50% do valor pago.
   *
   * @throws {ErroDeDividaNaoEncontrada} Se a dívida não existir (404).
   * @throws {ErroDeDividaNaoRenegociavel} Se a dívida não estiver EM_ABERTO (422).
   * @throws {ErroDeRenegociacaoAbaixoDoMinimo} Se `valorPago` for menor que 50% da dívida (422).
   */
  async renegociar(
    idDivida: number,
    dados: DadosDaRenegociacao,
    autor: Sessao,
  ): Promise<DividaDetalhada> {
    const divida = await this.buscarOuFalhar(idDivida);
    if (divida.status !== 'EM_ABERTO') {
      throw new ErroDeDividaNaoRenegociavel();
    }
    const minimoEmCentavos = Math.ceil(divida.valorDivida * FRACAO_MINIMA_DA_RENEGOCIACAO);
    if (dados.valorPago < minimoEmCentavos) {
      throw new ErroDeRenegociacaoAbaixoDoMinimo(minimoEmCentavos);
    }
    await this.dividas.renegociar(idDivida, {
      dataRenegociacao: dados.dataRenegociacao,
      valorPagoRenegociacao: dados.valorPago,
    });
    this.logger.info(
      { evento: 'divida_renegociada', idDivida, idAutor: autor.idOperador },
      'Dívida renegociada.',
    );
    const [detalhada] = await this.comNomeDoCliente([await this.buscarOuFalhar(idDivida)]);
    return detalhada as DividaDetalhada;
  }

  /**
   * Marca a dívida como quitada (passo 5 da UC23).
   *
   * @throws {ErroDeDividaNaoEncontrada} Se a dívida não existir (404).
   * @throws {ErroDeDividaNaoRenegociavel} Se a dívida já estiver QUITADA ou PROTESTADA (422).
   */
  async quitar(idDivida: number, autor: Sessao): Promise<DividaDetalhada> {
    const divida = await this.buscarOuFalhar(idDivida);
    if (divida.status === 'QUITADA' || divida.status === 'PROTESTADA') {
      throw new ErroDeDividaNaoRenegociavel();
    }
    await this.dividas.quitar(idDivida);
    this.logger.info(
      { evento: 'divida_quitada', idDivida, idAutor: autor.idOperador },
      'Dívida quitada.',
    );
    const [detalhada] = await this.comNomeDoCliente([await this.buscarOuFalhar(idDivida)]);
    return detalhada as DividaDetalhada;
  }

  private async buscarOuFalhar(idDivida: number): Promise<Divida> {
    const divida = await this.dividas.buscarPorId(idDivida);
    if (!divida) {
      throw new ErroDeDividaNaoEncontrada();
    }
    return divida;
  }

  private async comNomeDoCliente(dividas: readonly Divida[]): Promise<DividaDetalhada[]> {
    const idsUnicos = [...new Set(dividas.map((divida) => divida.idCliente))];
    const clientes = await Promise.all(idsUnicos.map((id) => this.clientes.buscarPorId(id)));
    const nomes = new Map<number, string>();
    clientes.forEach((cliente, indice) => {
      if (cliente) {
        nomes.set(idsUnicos[indice] as number, cliente.razaoSocial);
      }
    });
    return dividas.map((divida) => ({ ...divida, cliente: nomes.get(divida.idCliente) ?? '' }));
  }
}
