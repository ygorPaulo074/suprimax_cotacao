// UC18 — faturamento mínimo e condições permitidas (docs/04, seções 4.1 e 4.2; docs/11, 11.6.3.1).
import { CalculoError } from './erros';
import {
  calcularFaltaParaFaturamentoMinimo,
  escolherCondicaoPadrao,
  listarCondicoesPermitidas,
} from './faturamento';

describe('calcularFaltaParaFaturamentoMinimo', () => {
  it.each([
    [0, 50000],
    [39235, 10765],
    [49999, 1],
    [50000, 0],
    [50001, 0],
  ])('total %i na segunda compra: faltam %i centavos', (valorTotalItens, faltam) => {
    expect(calcularFaltaParaFaturamentoMinimo({ valorTotalItens, primeiraCompra: false })).toBe(
      faltam,
    );
  });

  it('não exige mínimo na primeira compra', () => {
    expect(calcularFaltaParaFaturamentoMinimo({ valorTotalItens: 100, primeiraCompra: true })).toBe(
      0,
    );
  });

  it('recusa valor que não é inteiro não negativo', () => {
    expect(() =>
      calcularFaltaParaFaturamentoMinimo({ valorTotalItens: 10.5, primeiraCompra: false }),
    ).toThrow(CalculoError);
  });
});

describe('listarCondicoesPermitidas', () => {
  const base = { primeiraCompra: false, resultadoCredito: 'APROVADO' as const };

  it.each([
    [49999, ['ADIANTADO_100']],
    [50000, ['ADIANTADO_100', 'BOLETO']],
    [149999, ['ADIANTADO_100', 'BOLETO']],
    [150000, ['ADIANTADO_100', 'BOLETO', 'PARCELADO']],
  ])('crédito aprovado, total %i', (valorTotalItens, esperado) => {
    expect(listarCondicoesPermitidas({ ...base, valorTotalItens })).toEqual(esperado);
  });

  it('sem itens não restringe por valor', () => {
    expect(listarCondicoesPermitidas({ ...base, valorTotalItens: 0 })).toEqual([
      'ADIANTADO_100',
      'BOLETO',
      'PARCELADO',
    ]);
  });

  it('primeira compra só aceita 100% adiantado', () => {
    expect(
      listarCondicoesPermitidas({ ...base, primeiraCompra: true, valorTotalItens: 500000 }),
    ).toEqual(['ADIANTADO_100']);
  });

  it('crédito reprovado oferece 100% e 50/50', () => {
    expect(
      listarCondicoesPermitidas({
        ...base,
        resultadoCredito: 'REPROVADO',
        valorTotalItens: 500000,
      }),
    ).toEqual(['ADIANTADO_100', 'ADIANTADO_50_50']);
  });

  it('crédito pendente oferece as condições por valor', () => {
    expect(
      listarCondicoesPermitidas({ ...base, resultadoCredito: null, valorTotalItens: 200000 }),
    ).toEqual(['ADIANTADO_100', 'BOLETO', 'PARCELADO']);
  });
});

describe('escolherCondicaoPadrao', () => {
  it.each([
    [true, null, 'ADIANTADO_100'],
    [true, 'REPROVADO', 'ADIANTADO_100'],
    [false, null, 'ADIANTADO_100'],
    [false, 'APROVADO', 'ADIANTADO_100'],
    [false, 'REPROVADO', 'ADIANTADO_50_50'],
  ] as const)(
    'primeira compra %s, crédito %s: %s',
    (primeiraCompra, resultadoCredito, esperada) => {
      expect(escolherCondicaoPadrao({ primeiraCompra, resultadoCredito })).toBe(esperada);
    },
  );

  it('o padrão sempre está entre as condições permitidas e não exige prazo nem parcelas', () => {
    for (const primeiraCompra of [true, false]) {
      for (const resultadoCredito of [null, 'APROVADO', 'REPROVADO'] as const) {
        for (const valorTotalItens of [0, 49999, 50000, 150000]) {
          const padrao = escolherCondicaoPadrao({ primeiraCompra, resultadoCredito });
          expect(
            listarCondicoesPermitidas({ valorTotalItens, primeiraCompra, resultadoCredito }),
          ).toContain(padrao);
          expect(['ADIANTADO_100', 'ADIANTADO_50_50']).toContain(padrao);
        }
      }
    }
  });
});
