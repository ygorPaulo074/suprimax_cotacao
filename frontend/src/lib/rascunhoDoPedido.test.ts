import { precisaDecidirRascunho, rotaDoRascunho } from './rascunhoDoPedido';

describe('decisão sobre o rascunho do pedido devolvido (UC10-A3)', () => {
  it('pede a decisão só em análise e com rascunho vinculado', () => {
    expect(precisaDecidirRascunho({ status: 'EM_ANALISE', idOrcamentoRascunho: 7 })).toBe(true);
    expect(precisaDecidirRascunho({ status: 'EM_ANALISE', idOrcamentoRascunho: null })).toBe(false);
    expect(precisaDecidirRascunho({ status: 'SOLICITADO', idOrcamentoRascunho: 7 })).toBe(false);
    expect(precisaDecidirRascunho({ status: 'APROVADO', idOrcamentoRascunho: 7 })).toBe(false);
  });

  it('retoma o rascunho pela rota do orçamento', () => {
    expect(rotaDoRascunho(7)).toBe('/orcamentos/7');
  });
});
