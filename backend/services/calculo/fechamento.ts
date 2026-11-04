// UC20 — docs/11, seção 11.6.3.6.
import { CalculoError } from './erros';
import { FATURAMENTO_MINIMO } from './regras';
import { calcularFrete } from './frete';
import { calcularImpostoItem } from './imposto';
import type {
  Centavos,
  ItemOrcamentoAprovado,
  ItemRecalculado,
  OrigemTransportadora,
  ResultadoFrete,
} from './types';
import { validarInteiroNaoNegativo, validarQuantidadePositiva } from './validacao';

export function recalcularOrcamentoAprovado({
  itens,
  primeiraCompra,
  origemTransportadora,
  valorFreteCotado,
}: {
  itens: ItemOrcamentoAprovado[];
  primeiraCompra: boolean;
  origemTransportadora?: OrigemTransportadora;
  valorFreteCotado?: Centavos | null;
}): {
  itens: ItemRecalculado[];
  valorTotalItensAprovado: Centavos;
  valorTotalImpostoAprovado: Centavos;
  todosAprovados: boolean;
  fechamento:
    | null
    | { ok: true; frete: ResultadoFrete; valorTotalAceito: Centavos }
    | { ok: false; motivo: 'ABAIXO_DO_MINIMO' };
} {
  if (!Array.isArray(itens) || typeof primeiraCompra !== 'boolean') {
    throw new CalculoError(
      'CALC_ENTRADA_INVALIDA',
      'itens',
      'lista e primeiraCompra booleano esperados',
    );
  }
  const itensRecalculados = itens.map<ItemRecalculado>((item) => {
    if (!Number.isInteger(item.idItem) || item.idItem < 1)
      throw new CalculoError('CALC_ENTRADA_INVALIDA', 'idItem', 'inteiro >= 1 esperado');
    validarQuantidadePositiva(item.quantidadeCotada);
    if (
      !Number.isInteger(item.quantidadeAprovada) ||
      item.quantidadeAprovada < 0 ||
      item.quantidadeAprovada > item.quantidadeCotada
    ) {
      throw new CalculoError(
        'CALC_ENTRADA_INVALIDA',
        'quantidadeAprovada',
        'inteiro entre zero e quantidade cotada esperado',
      );
    }
    if (item.quantidadeAprovada === 0)
      return {
        idItem: item.idItem,
        situacao: 'NAO_APROVADO',
        quantidadeAprovada: 0,
        idFaixaPrecoAceita: null,
        precoUnitarioAceito: null,
        valorLinha: 0,
        imposto: 0,
        totalItem: 0,
      };
    let preco: Centavos;
    let idFaixaPrecoAceita: number | null = null;
    if (item.granularidade === 'FARDO') {
      if (item.precoFardo === undefined)
        throw new CalculoError(
          'CALC_GRANULARIDADE_INVALIDA',
          'precoFardo',
          'obrigatório para granularidade FARDO',
        );
      validarInteiroNaoNegativo(item.precoFardo, 'precoFardo');
      preco = item.precoFardo;
    } else if (item.granularidade === 'AVULSO') {
      if (!item.faixas?.length)
        throw new CalculoError(
          'CALC_GRANULARIDADE_INVALIDA',
          'faixas',
          'obrigatório para granularidade AVULSO',
        );
      const faixa = item.faixas
        .filter((f) => f.quantidadeMinima <= item.quantidadeAprovada)
        .sort((a, b) => b.quantidadeMinima - a.quantidadeMinima)[0];
      if (!faixa)
        throw new CalculoError(
          'CALC_FAIXA_NAO_ENCONTRADA',
          'faixas',
          `nenhuma faixa atende a quantidade ${item.quantidadeAprovada}`,
        );
      validarInteiroNaoNegativo(faixa.precoUnitario, 'precoUnitario');
      preco = faixa.precoUnitario;
      idFaixaPrecoAceita = faixa.idFaixaPreco;
    } else {
      throw new CalculoError(
        'CALC_GRANULARIDADE_INVALIDA',
        'granularidade',
        `recebido ${item.granularidade}`,
      );
    }
    const resultado = calcularImpostoItem({
      quantidade: item.quantidadeAprovada,
      precoUnitarioAplicado: preco,
    });
    return {
      idItem: item.idItem,
      situacao: 'APROVADO',
      quantidadeAprovada: item.quantidadeAprovada,
      idFaixaPrecoAceita,
      precoUnitarioAceito: preco,
      valorLinha: resultado.valorLinha,
      imposto: resultado.imposto,
      totalItem: resultado.totalItem,
    };
  });
  const aprovados = itensRecalculados.filter((item) => item.situacao === 'APROVADO');
  const valorTotalItensAprovado = aprovados.reduce((total, item) => total + item.totalItem, 0);
  const valorTotalImpostoAprovado = aprovados.reduce((total, item) => total + item.imposto, 0);
  const todosAprovados = itensRecalculados.every((item) => item.situacao === 'APROVADO');
  if (!todosAprovados)
    return {
      itens: itensRecalculados,
      valorTotalItensAprovado,
      valorTotalImpostoAprovado,
      todosAprovados,
      fechamento: null,
    };
  if (!primeiraCompra && valorTotalItensAprovado < FATURAMENTO_MINIMO)
    return {
      itens: itensRecalculados,
      valorTotalItensAprovado,
      valorTotalImpostoAprovado,
      todosAprovados,
      fechamento: { ok: false, motivo: 'ABAIXO_DO_MINIMO' },
    };
  const frete = calcularFrete({
    valorTotalItens: valorTotalItensAprovado,
    origemTransportadora,
    valorFreteCotado,
  });
  const valorFrete = frete.valorFrete ?? 0;
  return {
    itens: itensRecalculados,
    valorTotalItensAprovado,
    valorTotalImpostoAprovado,
    todosAprovados,
    fechamento: { ok: true, frete, valorTotalAceito: valorTotalItensAprovado + valorFrete },
  };
}
