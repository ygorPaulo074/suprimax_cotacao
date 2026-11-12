// UC04 — o que precisa mudar no banco para um produto passar do estado gravado ao estado pedido
// em `PUT /produtos/:id`. Funções puras: não leem nem gravam nada.
import type { DadosDaVariacao, DadosDoProduto } from './esquemas';
import type {
  CamposDoProduto,
  Fardo,
  FaixaDePreco,
  Produto,
  VariacaoAInserir,
  VariacaoDeProduto,
} from './repositorio';

/** Faixa de preço a criar em uma variação que já existe. */
export interface FaixaAInserir {
  readonly idVariacao: number;
  readonly quantidadeMinima: number;
  readonly precoUnitario: number;
}

/** Fardo a criar em uma variação que já existe. */
export interface FardoAInserir {
  readonly idVariacao: number;
  readonly quantidadeUnidades: number;
  readonly precoFixo: number;
}

/** Variação que deixa de existir, com os preços que saem junto com ela. */
export interface VariacaoARemover {
  readonly idVariacao: number;
  readonly idsDasFaixas: readonly number[];
  readonly idsDosFardos: readonly number[];
}

/** Mudanças a gravar. Listas vazias e `produto` ausente significam "nada a fazer". */
export interface PlanoDeAtualizacao {
  readonly idProduto: number;
  /** Presente só quando algum campo do produto mudou. */
  readonly produto?: CamposDoProduto;
  readonly variacoesNovas: readonly VariacaoAInserir[];
  readonly variacoesAlteradas: readonly Pick<
    VariacaoDeProduto,
    'idVariacao' | 'marca' | 'tamanhoEmbalagem'
  >[];
  readonly variacoesRemovidas: readonly VariacaoARemover[];
  readonly faixasNovas: readonly FaixaAInserir[];
  readonly faixasAlteradas: readonly Pick<FaixaDePreco, 'idFaixaPreco' | 'precoUnitario'>[];
  readonly idsDasFaixasRemovidas: readonly number[];
  readonly fardosNovos: readonly FardoAInserir[];
  readonly fardosAlterados: readonly Pick<Fardo, 'idFardo' | 'precoFixo'>[];
  readonly idsDosFardosRemovidos: readonly number[];
}

interface DiferencaDePrecos<Atual, Pedido> {
  readonly novos: Pedido[];
  /** Linha gravada e o que foi pedido para ela, quando o preço difere. */
  readonly alterados: { readonly atual: Atual; readonly pedido: Pedido }[];
  readonly removidos: Atual[];
}

/**
 * Compara os preços gravados com os pedidos. A quantidade identifica a linha: quantidade nova é
 * linha nova, quantidade que sumiu é linha removida, e quantidade mantida com outro preço é
 * linha alterada (o identificador é preservado, porque orçamentos já emitidos apontam para ele).
 * Linhas gravadas com quantidade repetida saem, ficando só a primeira.
 */
function compararPrecos<Atual, Pedido>(
  atuais: readonly Atual[],
  pedidos: readonly Pedido[],
  quantidadeDoAtual: (linha: Atual) => number,
  quantidadeDoPedido: (linha: Pedido) => number,
  precoMudou: (atual: Atual, pedido: Pedido) => boolean,
): DiferencaDePrecos<Atual, Pedido> {
  const porQuantidade = new Map<number, Atual>();
  const removidos: Atual[] = [];
  for (const atual of atuais) {
    const quantidade = quantidadeDoAtual(atual);
    if (porQuantidade.has(quantidade)) {
      removidos.push(atual);
    } else {
      porQuantidade.set(quantidade, atual);
    }
  }
  const novos: Pedido[] = [];
  const alterados: { atual: Atual; pedido: Pedido }[] = [];
  for (const pedido of pedidos) {
    const quantidade = quantidadeDoPedido(pedido);
    const atual = porQuantidade.get(quantidade);
    porQuantidade.delete(quantidade);
    if (atual === undefined) {
      novos.push(pedido);
    } else if (precoMudou(atual, pedido)) {
      alterados.push({ atual, pedido });
    }
  }
  return { novos, alterados, removidos: [...removidos, ...porQuantidade.values()] };
}

function camposDoProduto(dados: DadosDoProduto | Produto): CamposDoProduto {
  const { codigoInterno, descricao, ncm, ean, categoria, ativo } = dados;
  return { codigoInterno, descricao, ncm, ean, categoria, ativo };
}

function produtoMudou(atual: Produto, pedido: DadosDoProduto): boolean {
  const [antes, depois] = [camposDoProduto(atual), camposDoProduto(pedido)];
  return (Object.keys(antes) as (keyof CamposDoProduto)[]).some(
    (campo) => antes[campo] !== depois[campo],
  );
}

/** Converte uma variação sem identificador nos dados da variação a criar. */
export function paraVariacaoAInserir(variacao: DadosDaVariacao): VariacaoAInserir {
  return {
    marca: variacao.marca,
    tamanhoEmbalagem: variacao.tamanhoEmbalagem,
    quantidadeEstoque: variacao.quantidadeEstoque ?? 0,
    faixasPreco: variacao.faixasPreco ?? [],
    fardos: variacao.fardos ?? [],
  };
}

/**
 * Calcula as mudanças entre o produto gravado e o corpo do `PUT`.
 *
 * - Variação sem `idVariacao` é criada; variação gravada que não veio no corpo é removida.
 * - `faixasPreco` ou `fardos` ausentes em uma variação existente deixam os preços dela como estão.
 *
 * Pressupõe que todo `idVariacao` do corpo pertence ao produto: quem chama confere antes.
 */
export function planejarAtualizacao(atual: Produto, pedido: DadosDoProduto): PlanoDeAtualizacao {
  const gravadas = new Map(atual.variacoes.map((variacao) => [variacao.idVariacao, variacao]));
  const plano = {
    idProduto: atual.idProduto,
    ...(produtoMudou(atual, pedido) && { produto: camposDoProduto(pedido) }),
    variacoesNovas: [] as VariacaoAInserir[],
    variacoesAlteradas: [] as PlanoDeAtualizacao['variacoesAlteradas'][number][],
    faixasNovas: [] as FaixaAInserir[],
    faixasAlteradas: [] as PlanoDeAtualizacao['faixasAlteradas'][number][],
    idsDasFaixasRemovidas: [] as number[],
    fardosNovos: [] as FardoAInserir[],
    fardosAlterados: [] as PlanoDeAtualizacao['fardosAlterados'][number][],
    idsDosFardosRemovidos: [] as number[],
  };

  for (const variacao of pedido.variacoes) {
    const gravada =
      variacao.idVariacao === undefined ? undefined : gravadas.get(variacao.idVariacao);
    if (gravada === undefined) {
      plano.variacoesNovas.push(paraVariacaoAInserir(variacao));
      continue;
    }
    gravadas.delete(gravada.idVariacao);
    const { idVariacao } = gravada;
    if (
      gravada.marca !== variacao.marca ||
      gravada.tamanhoEmbalagem !== variacao.tamanhoEmbalagem
    ) {
      const { marca, tamanhoEmbalagem } = variacao;
      plano.variacoesAlteradas.push({ idVariacao, marca, tamanhoEmbalagem });
    }
    if (variacao.faixasPreco !== undefined) {
      const faixas = compararPrecos(
        gravada.faixasPreco,
        variacao.faixasPreco,
        (faixa) => faixa.quantidadeMinima,
        (faixa) => faixa.quantidadeMinima,
        (antes, depois) => antes.precoUnitario !== depois.precoUnitario,
      );
      plano.faixasNovas.push(...faixas.novos.map((faixa) => ({ idVariacao, ...faixa })));
      plano.faixasAlteradas.push(
        ...faixas.alterados.map(({ atual: gravado, pedido: novo }) => ({
          idFaixaPreco: gravado.idFaixaPreco,
          precoUnitario: novo.precoUnitario,
        })),
      );
      plano.idsDasFaixasRemovidas.push(...faixas.removidos.map((faixa) => faixa.idFaixaPreco));
    }
    if (variacao.fardos !== undefined) {
      const fardos = compararPrecos(
        gravada.fardos,
        variacao.fardos,
        (fardo) => fardo.quantidadeUnidades,
        (fardo) => fardo.quantidadeUnidades,
        (antes, depois) => antes.precoFixo !== depois.precoFixo,
      );
      plano.fardosNovos.push(...fardos.novos.map((fardo) => ({ idVariacao, ...fardo })));
      plano.fardosAlterados.push(
        ...fardos.alterados.map(({ atual: gravado, pedido: novo }) => ({
          idFardo: gravado.idFardo,
          precoFixo: novo.precoFixo,
        })),
      );
      plano.idsDosFardosRemovidos.push(...fardos.removidos.map((fardo) => fardo.idFardo));
    }
  }

  const variacoesRemovidas = [...gravadas.values()].map((variacao) => ({
    idVariacao: variacao.idVariacao,
    idsDasFaixas: variacao.faixasPreco.map((faixa) => faixa.idFaixaPreco),
    idsDosFardos: variacao.fardos.map((fardo) => fardo.idFardo),
  }));
  return { ...plano, variacoesRemovidas };
}

/** Indica se o plano não tem nenhuma mudança a gravar. */
export function planoEstaVazio(plano: PlanoDeAtualizacao): boolean {
  return (
    plano.produto === undefined &&
    [
      plano.variacoesNovas,
      plano.variacoesAlteradas,
      plano.variacoesRemovidas,
      plano.faixasNovas,
      plano.faixasAlteradas,
      plano.idsDasFaixasRemovidas,
      plano.fardosNovos,
      plano.fardosAlterados,
      plano.idsDosFardosRemovidos,
    ].every((lista) => lista.length === 0)
  );
}
