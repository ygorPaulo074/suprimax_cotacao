// UC04 — cadastro de produtos com variações, faixas de preço e fardos (RF02, RF09).
import {
  ErroDeAcessoNegado,
  ErroDeProdutoJaCadastrado,
  ErroDeProdutoNaoEncontrado,
  ErroDeRegistroEmUso,
  ErroDeValidacao,
} from '../../erros';
import type { Logger } from '../../log';
import type { Perfil, Sessao } from '../auth/sessoes';
import { calcularSaldoDisponivel } from '../comum/estoque';
import type { DadosDoProduto, FiltroDeBuscaDeProdutos } from './esquemas';
import {
  paraVariacaoAInserir,
  planejarAtualizacao,
  planoEstaVazio,
  type PlanoDeAtualizacao,
} from './plano';
import type {
  CamposDoProduto,
  Produto,
  RepositorioDeProdutos,
  VariacaoDeProduto,
} from './repositorio';

/** Único perfil que define ou altera preços (UC04, passo 4). */
export const PERFIL_QUE_ALTERA_PRECOS: Perfil = 'OPERADOR_CHEFE';

const MENSAGENS = {
  PRECOS_SO_DO_CHEFE: 'Somente o operador chefe altera faixas de preço e fardos.',
  REMOCAO_SO_DO_CHEFE:
    'Somente o operador chefe remove uma variação que tem faixas de preço ou fardos.',
  VARIACAO_DE_OUTRO_PRODUTO: 'A variação informada não pertence a este produto.',
  VARIACAO_EM_PRODUTO_NOVO: 'Um produto novo não pode receber variações já cadastradas.',
  FAIXA_EM_USO:
    'Uma faixa de preço já usada em orçamento não pode ser removida. Mantenha a faixa e altere só o preço.',
  FARDO_EM_USO:
    'Um fardo já usado em pedido ou orçamento não pode ser removido. Mantenha o fardo e altere só o preço.',
} as const;

function descrever({ marca, tamanhoEmbalagem }: VariacaoDeProduto): string {
  return `${marca} · ${tamanhoEmbalagem}`;
}

export interface DependenciasDoServicoDeProdutos {
  readonly produtos: RepositorioDeProdutos;
  readonly logger: Logger;
}

/** Regras do cadastro de produtos (UC04). */
export class ServicoDeProdutos {
  private readonly produtos: RepositorioDeProdutos;
  private readonly logger: Logger;

  constructor(dependencias: DependenciasDoServicoDeProdutos) {
    this.produtos = dependencias.produtos;
    this.logger = dependencias.logger;
  }

  /** Lista os produtos; com `termo`, só os que o têm na descrição, no código interno ou no EAN. */
  listar(termo?: string): Promise<Produto[]> {
    return this.produtos.listar(termo);
  }

  /**
   * Catálogo para compor um orçamento (UC15): só produtos ativos, com os filtros de marca,
   * tamanho/embalagem e categoria aplicados de forma cumulativa (RN09), e só variações que têm
   * ao menos um preço definido — faixa ou fardo (RN08). O preço é único por produto/variação, sem
   * tabela diferenciada por cliente (RN04), então `idCliente` não entra no filtro.
   */
  async buscar(filtro: FiltroDeBuscaDeProdutos): Promise<Produto[]> {
    const produtos = await this.produtos.listar(filtro.q);
    const filtrados = produtos
      .filter((produto) => produto.ativo)
      .filter((produto) => filtro.categoria === undefined || produto.categoria === filtro.categoria)
      .map((produto) => ({
        ...produto,
        variacoes: produto.variacoes.filter(
          (variacao) =>
            (variacao.faixasPreco.length > 0 || variacao.fardos.length > 0) &&
            (filtro.marca === undefined || variacao.marca === filtro.marca) &&
            (filtro.tamanhoEmbalagem === undefined ||
              variacao.tamanhoEmbalagem === filtro.tamanhoEmbalagem),
        ),
      }))
      .filter((produto) => produto.variacoes.length > 0);
    const idsDasVariacoes = filtrados.flatMap((produto) =>
      produto.variacoes.map((variacao) => variacao.idVariacao),
    );
    const reservado = await this.produtos.buscarReservadoPorVariacao(idsDasVariacoes);
    return filtrados.map((produto) => ({
      ...produto,
      variacoes: produto.variacoes.map((variacao) => ({
        ...variacao,
        saldoDisponivel: calcularSaldoDisponivel(
          variacao.quantidadeEstoque,
          reservado.get(variacao.idVariacao) ?? 0,
        ),
      })),
    }));
  }

  /**
   * Produto com variações e preços.
   *
   * @throws {ErroDeProdutoNaoEncontrado} Se o produto não existir.
   */
  async obter(idProduto: number): Promise<Produto> {
    const produto = await this.produtos.buscarPorId(idProduto);
    if (!produto) {
      throw new ErroDeProdutoNaoEncontrado();
    }
    return produto;
  }

  /**
   * Cadastra o produto com suas variações.
   *
   * @param autor Quem fez o cadastro; só o operador chefe pode informar faixas e fardos.
   * @throws {ErroDeAcessoNegado} Se outro perfil informar faixas de preço ou fardos.
   * @throws {ErroDeValidacao} Se alguma variação vier com identificador.
   * @throws {ErroDeProdutoJaCadastrado} Se o código interno ou o EAN já pertencer a outro produto.
   */
  async criar(dados: DadosDoProduto, autor: Sessao): Promise<Produto> {
    this.exigirPermissaoParaPrecos(dados, autor);
    const reaproveitadas = dados.variacoes.flatMap((variacao, posicao) =>
      variacao.idVariacao === undefined ? [] : [`variacoes.${posicao}.idVariacao`],
    );
    if (reaproveitadas.length > 0) {
      throw new ErroDeValidacao({
        mensagem: MENSAGENS.VARIACAO_EM_PRODUTO_NOVO,
        detalhes: { campos: reaproveitadas },
      });
    }
    await this.exigirCamposUnicos(dados);
    const idProduto = await this.gravar(dados, () =>
      this.produtos.inserir({ ...dados, variacoes: dados.variacoes.map(paraVariacaoAInserir) }),
    );
    this.logger.info(
      { evento: 'produto_cadastrado', idProduto, idAutor: autor.idOperador },
      'Produto cadastrado.',
    );
    return this.obter(idProduto);
  }

  /**
   * Altera o produto. A lista de variações do corpo é a lista completa: variação sem
   * identificador é criada, e variação gravada que não veio é removida.
   *
   * Uma variação só é removida se não tiver estoque nem tiver sido usada em pedido, orçamento ou
   * movimentação de estoque; faixa e fardo só são removidos se nenhum orçamento ou pedido os usar.
   *
   * @param autor Quem fez a alteração; só o operador chefe mexe em faixas e fardos.
   * @throws {ErroDeProdutoNaoEncontrado} Se o produto não existir.
   * @throws {ErroDeAcessoNegado} Se outro perfil informar preços ou remover variação com preços.
   * @throws {ErroDeValidacao} Se alguma variação do corpo não pertencer ao produto.
   * @throws {ErroDeProdutoJaCadastrado} Se o código interno ou o EAN já pertencer a outro produto.
   * @throws {ErroDeRegistroEmUso} Se uma remoção atingir um registro em uso.
   */
  async atualizar(idProduto: number, dados: DadosDoProduto, autor: Sessao): Promise<Produto> {
    const atual = await this.obter(idProduto);
    this.exigirPermissaoParaPrecos(dados, autor);
    this.exigirVariacoesDoProduto(atual, dados);
    const plano = planejarAtualizacao(atual, dados);
    if (planoEstaVazio(plano)) {
      return atual;
    }
    this.exigirPermissaoParaRemover(plano, autor);
    await this.exigirCamposUnicos(dados, idProduto);
    await this.exigirRemocoesPossiveis(atual, plano);
    await this.gravar(dados, () => this.produtos.aplicar(plano), idProduto);
    this.logger.info(
      {
        evento: 'produto_alterado',
        idProduto,
        variacoesNovas: plano.variacoesNovas.length,
        variacoesRemovidas: plano.variacoesRemovidas.length,
        precosAlterados:
          plano.faixasNovas.length +
          plano.faixasAlteradas.length +
          plano.idsDasFaixasRemovidas.length +
          plano.fardosNovos.length +
          plano.fardosAlterados.length +
          plano.idsDosFardosRemovidos.length,
        idAutor: autor.idOperador,
      },
      'Produto alterado.',
    );
    return this.obter(idProduto);
  }

  /** Preço é assunto do operador chefe: outro perfil não pode nem enviar as listas. */
  private exigirPermissaoParaPrecos(dados: DadosDoProduto, autor: Sessao): void {
    const informouPrecos = dados.variacoes.some(
      (variacao) => variacao.faixasPreco !== undefined || variacao.fardos !== undefined,
    );
    if (informouPrecos && autor.perfil !== PERFIL_QUE_ALTERA_PRECOS) {
      throw new ErroDeAcessoNegado(MENSAGENS.PRECOS_SO_DO_CHEFE);
    }
  }

  /** Remover uma variação apaga os preços dela, o que também é assunto do operador chefe. */
  private exigirPermissaoParaRemover(plano: PlanoDeAtualizacao, autor: Sessao): void {
    const removePrecos = plano.variacoesRemovidas.some(
      ({ idsDasFaixas, idsDosFardos }) => idsDasFaixas.length > 0 || idsDosFardos.length > 0,
    );
    if (removePrecos && autor.perfil !== PERFIL_QUE_ALTERA_PRECOS) {
      throw new ErroDeAcessoNegado(MENSAGENS.REMOCAO_SO_DO_CHEFE);
    }
  }

  private exigirVariacoesDoProduto(atual: Produto, dados: DadosDoProduto): void {
    const doProduto = new Set(atual.variacoes.map((variacao) => variacao.idVariacao));
    const estranhas = dados.variacoes.flatMap(({ idVariacao }, posicao) =>
      idVariacao === undefined || doProduto.has(idVariacao)
        ? []
        : [`variacoes.${posicao}.idVariacao`],
    );
    if (estranhas.length > 0) {
      throw new ErroDeValidacao({
        mensagem: MENSAGENS.VARIACAO_DE_OUTRO_PRODUTO,
        detalhes: { campos: estranhas },
      });
    }
  }

  private async exigirCamposUnicos(campos: CamposDoProduto, idIgnorado?: number): Promise<void> {
    const duplicados = await this.produtos.buscarCamposDuplicados(campos, idIgnorado);
    if (duplicados.length > 0) {
      throw new ErroDeProdutoJaCadastrado(duplicados);
    }
  }

  private async exigirRemocoesPossiveis(atual: Produto, plano: PlanoDeAtualizacao): Promise<void> {
    const removidas = new Set(plano.variacoesRemovidas.map(({ idVariacao }) => idVariacao));
    for (const variacao of atual.variacoes.filter(({ idVariacao }) => removidas.has(idVariacao))) {
      if (variacao.quantidadeEstoque > 0) {
        throw new ErroDeRegistroEmUso(
          `A variação ${descrever(variacao)} ainda tem estoque e não pode ser removida.`,
        );
      }
      if (await this.produtos.existeReferencia('variacao', [variacao.idVariacao])) {
        throw new ErroDeRegistroEmUso(
          `A variação ${descrever(variacao)} já foi usada em pedido, orçamento ou movimentação de estoque e não pode ser removida.`,
        );
      }
    }
    if (await this.produtos.existeReferencia('faixa', plano.idsDasFaixasRemovidas)) {
      throw new ErroDeRegistroEmUso(MENSAGENS.FAIXA_EM_USO);
    }
    if (await this.produtos.existeReferencia('fardo', plano.idsDosFardosRemovidos)) {
      throw new ErroDeRegistroEmUso(MENSAGENS.FARDO_EM_USO);
    }
  }

  /**
   * Executa a gravação. Se ela falhar porque outro cadastro com o mesmo código interno ou EAN
   * chegou ao mesmo tempo, o erro vira o mesmo conflito da conferência inicial.
   */
  private async gravar<T>(
    campos: CamposDoProduto,
    gravacao: () => Promise<T>,
    idIgnorado?: number,
  ): Promise<T> {
    try {
      return await gravacao();
    } catch (erro) {
      const duplicados = await this.produtos.buscarCamposDuplicados(campos, idIgnorado);
      if (duplicados.length > 0) {
        throw new ErroDeProdutoJaCadastrado(duplicados);
      }
      throw erro;
    }
  }
}
