import { ApiError } from '@/api/errors';
import { camposRecusados, semCaminho } from './errosDeCampo';

const validacao = (campos: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', 'Os dados enviados são inválidos.', { campos });

describe('camposRecusados', () => {
  it('lê os caminhos de detalhes.campos e o código do erro', () => {
    const recusa = camposRecusados(validacao(['ncm', 'variacoes.0.quantidadeEstoque']));
    expect(recusa?.codigo).toBe('VALIDATION_ERROR');
    expect([...(recusa?.caminhos ?? [])]).toEqual(['ncm', 'variacoes.0.quantidadeEstoque']);
  });

  it.each([
    ['erro que não é da API', new Error('x')],
    ['sem detalhes', new ApiError(400, 'VALIDATION_ERROR', 'x')],
    ['campos que não é lista', validacao('ncm')],
    ['lista vazia', validacao([])],
    ['lista só com valores inválidos', validacao(['', 3, null])],
  ])('devolve null para %s', (_caso, erro) => {
    expect(camposRecusados(erro)).toBeNull();
  });

  it('ignora entradas que não são texto', () => {
    const recusa = camposRecusados(validacao(['ean', 7, '']));
    expect([...(recusa?.caminhos ?? [])]).toEqual(['ean']);
  });
});

describe('semCaminho', () => {
  it('tira só o caminho editado', () => {
    const recusa = camposRecusados(validacao(['ncm', 'ean']));
    expect([...(semCaminho(recusa, 'ncm')?.caminhos ?? [])]).toEqual(['ean']);
  });

  it('devolve a mesma recusa quando o caminho não está nela', () => {
    const recusa = camposRecusados(validacao(['ncm']));
    expect(semCaminho(recusa, 'ean')).toBe(recusa);
    expect(semCaminho(null, 'ean')).toBeNull();
  });
});
