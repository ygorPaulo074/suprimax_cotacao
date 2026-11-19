import {
  cabecalhoComparavel,
  condicoesComparaveis,
  type EntradaCondicoes,
} from './montagemComparavel';

const base: EntradaCondicoes = {
  pagamento: 'ADIANTADO_100',
  prazoDias: 10,
  parcelas: 2,
  ehFob: true,
  origem: 'SUPRIMAX',
  transportadora: 'Log',
  frete: 150050,
};

describe('cabecalhoComparavel', () => {
  it('nulo, vazio e espaços são iguais; número e texto também', () => {
    expect(
      cabecalhoComparavel({ contato: null, solicitacao: '  ', endereco: 20, prazoEntrega: 5 }),
    ).toBe(
      cabecalhoComparavel({ contato: '', solicitacao: null, endereco: '20', prazoEntrega: '5' }),
    );
  });
  it('valores diferentes diferem', () => {
    expect(
      cabecalhoComparavel({ contato: 'A', solicitacao: '', endereco: '', prazoEntrega: '' }),
    ).not.toBe(
      cabecalhoComparavel({ contato: 'B', solicitacao: '', endereco: '', prazoEntrega: '' }),
    );
  });
});

describe('condicoesComparaveis', () => {
  it('frete em texto formatado e em centavos inteiros são o mesmo valor', () => {
    expect(condicoesComparaveis({ ...base, frete: ' R$ 1.500,50 ' })).toBe(
      condicoesComparaveis(base),
    );
    expect(condicoesComparaveis({ ...base, frete: '1500,5' })).toBe(condicoesComparaveis(base));
    expect(condicoesComparaveis({ ...base, frete: '1500,51' })).not.toBe(
      condicoesComparaveis(base),
    );
  });
  it('frete vazio e null são iguais; texto inválido difere de tudo', () => {
    expect(condicoesComparaveis({ ...base, frete: '' })).toBe(
      condicoesComparaveis({ ...base, frete: null }),
    );
    expect(condicoesComparaveis({ ...base, frete: 'abc' })).not.toBe(
      condicoesComparaveis({ ...base, frete: null }),
    );
  });
  it('campos que não valem para a condição escolhida são ignorados', () => {
    expect(condicoesComparaveis({ ...base, prazoDias: 30, parcelas: 6 })).toBe(
      condicoesComparaveis(base),
    );
    expect(condicoesComparaveis({ ...base, pagamento: 'BOLETO', prazoDias: '30' })).not.toBe(
      condicoesComparaveis({ ...base, pagamento: 'BOLETO', prazoDias: 10 }),
    );
    expect(condicoesComparaveis({ ...base, ehFob: false, transportadora: 'Outra', frete: 1 })).toBe(
      condicoesComparaveis({ ...base, ehFob: false }),
    );
    expect(condicoesComparaveis({ ...base, origem: 'CLIENTE', frete: 1 })).toBe(
      condicoesComparaveis({ ...base, origem: 'CLIENTE', frete: 2 }),
    );
  });
});
