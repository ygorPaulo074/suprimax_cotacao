// docs/11, seção 11.6.2.3. Todo código novo entra na tabela da documentação antes de ir para produção.
export type CodigoCalculoError =
  | 'CALC_ENTRADA_INVALIDA'
  | 'CALC_PRAZO_INVALIDO'
  | 'CALC_PARCELAS_INVALIDAS'
  | 'CALC_DATA_INVALIDA'
  | 'CALC_NUMERO_INVALIDO'
  | 'CALC_FAIXA_NAO_ENCONTRADA'
  | 'CALC_GRANULARIDADE_INVALIDA';

export class CalculoError extends Error {
  constructor(
    public readonly codigo: CodigoCalculoError,
    public readonly campo: string,
    public readonly detalhe: string,
  ) {
    super(`${codigo}: ${campo} — ${detalhe}`);
    this.name = 'CalculoError';
  }
}
