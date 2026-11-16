// UC24 — consulta e ajuste do estoque físico (RF26, RN14).
import { calcularSaldoDisponivel, somarReservasPorVariacao } from '../comum/estoque';
import type { ClienteDeProxy } from '../../dados';
import { ErroDeAjusteAbaixoDoReservado, ErroDeVariacaoNaoEncontrada } from '../../erros';
import type { Logger } from '../../log';
import type { Sessao } from '../auth/sessoes';
import type { RepositorioDeUsuarios } from '../usuarios/repositorio';
import type { DadosDoAjusteDeEstoque } from './esquemas';
import type { Movimentacao, RepositorioDeEstoque, VariacaoDeEstoque } from './repositorio';

/** Saldo da variação (`SaldoEstoque` do frontend). */
export interface SaldoEstoque {
  readonly idVariacao: number;
  readonly produto: string;
  readonly marca: string;
  readonly tamanhoEmbalagem: string;
  readonly saldoFisico: number;
  readonly reservado: number;
  readonly disponivel: number;
}

/** Movimentação com o nome de quem a originou (`MovimentacaoEstoque` do frontend). */
export interface MovimentacaoDetalhada {
  readonly idMovimentacao: number;
  readonly tipo: Movimentacao['tipo'];
  readonly quantidade: number;
  readonly usuario: string | null;
  readonly motivo: string | null;
  readonly dataMovimentacao: string;
}

export interface DependenciasDoServicoDeEstoque {
  readonly estoque: RepositorioDeEstoque;
  readonly usuarios: RepositorioDeUsuarios;
  readonly proxy: ClienteDeProxy;
  readonly logger: Logger;
}

/** Regras de consulta e ajuste do estoque físico (UC24). */
export class ServicoDeEstoque {
  private readonly estoque: RepositorioDeEstoque;
  private readonly usuarios: RepositorioDeUsuarios;
  private readonly proxy: ClienteDeProxy;
  private readonly logger: Logger;

  constructor(dependencias: DependenciasDoServicoDeEstoque) {
    this.estoque = dependencias.estoque;
    this.usuarios = dependencias.usuarios;
    this.proxy = dependencias.proxy;
    this.logger = dependencias.logger;
  }

  /** Saldo de todas as variações que batem com `termo` (marca ou produto); sem `termo`, todas. */
  async listarSaldo(termo?: string): Promise<SaldoEstoque[]> {
    const variacoes = await this.estoque.listarVariacoes(termo);
    return this.comSaldo(variacoes);
  }

  /**
   * Saldo de uma variação.
   *
   * @throws {ErroDeVariacaoNaoEncontrada} Se a variação não existir (404).
   */
  async obterSaldo(idVariacao: number): Promise<SaldoEstoque> {
    const [saldo] = await this.comSaldo([await this.buscarVariacaoOuFalhar(idVariacao)]);
    return saldo as SaldoEstoque;
  }

  /**
   * Histórico de movimentações da variação, com o nome de quem a originou.
   *
   * @throws {ErroDeVariacaoNaoEncontrada} Se a variação não existir (404).
   */
  async listarMovimentacoes(idVariacao: number): Promise<MovimentacaoDetalhada[]> {
    await this.buscarVariacaoOuFalhar(idVariacao);
    const movimentacoes = await this.estoque.listarMovimentacoes(idVariacao);
    const idsUnicos = [
      ...new Set(
        movimentacoes
          .map((movimentacao) => movimentacao.idOperador)
          .filter((id): id is number => id !== null),
      ),
    ];
    const operadores = await Promise.all(idsUnicos.map((id) => this.usuarios.buscarPorId(id)));
    const nomes = new Map<number, string>();
    operadores.forEach((operador, indice) => {
      if (operador) {
        nomes.set(idsUnicos[indice] as number, operador.usuario);
      }
    });
    return movimentacoes.map((movimentacao) => ({
      idMovimentacao: movimentacao.idMovimentacao,
      tipo: movimentacao.tipo,
      quantidade: movimentacao.quantidade,
      usuario:
        movimentacao.idOperador === null ? null : (nomes.get(movimentacao.idOperador) ?? null),
      motivo: movimentacao.motivo,
      dataMovimentacao: movimentacao.dataMovimentacao,
    }));
  }

  /**
   * Ajusta o estoque físico (UC24): registra a movimentação AJUSTE e soma (ou subtrai) do saldo.
   *
   * @throws {ErroDeVariacaoNaoEncontrada} Se a variação não existir (404).
   * @throws {ErroDeAjusteAbaixoDoReservado} Se o ajuste deixar o saldo físico menor que o total
   * reservado (422, UC24-E2).
   */
  async ajustar(
    idVariacao: number,
    dados: DadosDoAjusteDeEstoque,
    autor: Sessao,
  ): Promise<SaldoEstoque> {
    const variacao = await this.buscarVariacaoOuFalhar(idVariacao);
    const reservas = await somarReservasPorVariacao(this.proxy, [idVariacao]);
    const reservado = reservas.get(idVariacao) ?? 0;
    const saldoFisicoApos = variacao.quantidadeEstoque + dados.quantidade;
    if (saldoFisicoApos < reservado) {
      throw new ErroDeAjusteAbaixoDoReservado(reservado);
    }
    await this.estoque.registrarMovimentacao({
      idVariacao,
      tipo: 'AJUSTE',
      quantidade: dados.quantidade,
      idOperador: autor.idOperador,
      motivo: dados.motivo,
      quantidadeEstoqueAtual: variacao.quantidadeEstoque,
    });
    this.logger.info(
      {
        evento: 'estoque_ajustado',
        idVariacao,
        quantidade: dados.quantidade,
        idAutor: autor.idOperador,
      },
      'Estoque ajustado.',
    );
    return this.obterSaldo(idVariacao);
  }

  private async buscarVariacaoOuFalhar(idVariacao: number): Promise<VariacaoDeEstoque> {
    const variacao = await this.estoque.buscarPorId(idVariacao);
    if (!variacao) {
      throw new ErroDeVariacaoNaoEncontrada();
    }
    return variacao;
  }

  private async comSaldo(variacoes: readonly VariacaoDeEstoque[]): Promise<SaldoEstoque[]> {
    const idsDasVariacoes = variacoes.map((variacao) => variacao.idVariacao);
    const [reservas, descricoes] = await Promise.all([
      somarReservasPorVariacao(this.proxy, idsDasVariacoes),
      this.estoque.buscarDescricoesPorId([
        ...new Set(variacoes.map((variacao) => variacao.idProduto)),
      ]),
    ]);
    return variacoes.map((variacao) => {
      const reservado = reservas.get(variacao.idVariacao) ?? 0;
      return {
        idVariacao: variacao.idVariacao,
        produto: descricoes.get(variacao.idProduto) ?? '',
        marca: variacao.marca,
        tamanhoEmbalagem: variacao.tamanhoEmbalagem,
        saldoFisico: variacao.quantidadeEstoque,
        reservado,
        disponivel: calcularSaldoDisponivel(variacao.quantidadeEstoque, reservado),
      };
    });
  }
}
