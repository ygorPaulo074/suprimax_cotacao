export type Centavos = number; // inteiro >= 0
export type DataISO = string; // 'AAAA-MM-DD'
export type ResultadoCredito = 'APROVADO' | 'REPROVADO' | null; // null = análise pendente
export type Granularidade = 'FARDO' | 'AVULSO';
export type CondicaoPagamento = 'ADIANTADO_100' | 'BOLETO' | 'PARCELADO' | 'ADIANTADO_50_50';
export type OrigemTransportadora = 'SUPRIMAX' | 'CLIENTE';

export interface ResultadoFreteCIF {
  modalidade: 'CIF';
  valorFrete: null;
  provisorio: false;
  origemTransportadora: null;
}

export interface ResultadoFreteFOB {
  modalidade: 'FOB';
  valorFrete: Centavos | null;
  provisorio: boolean;
  origemTransportadora: OrigemTransportadora;
}

export type ResultadoFrete = ResultadoFreteCIF | ResultadoFreteFOB;

export type MotivoCondicaoFaturamento =
  | 'ABAIXO_DO_MINIMO'
  | 'CREDITO_PENDENTE'
  | 'CREDITO_REPROVADO'
  | 'PARCELAMENTO_INDISPONIVEL'
  | 'PARCELA_ABAIXO_DO_MINIMO';

export interface ResultadoFaturamentoAprovado {
  ok: true;
  condicao: CondicaoPagamento;
  prazoDias: number | null;
  numeroParcelas: number | null;
  valorParcela: Centavos | null;
  exigeAnaliseCredito: boolean;
}

export interface ResultadoFaturamentoRecusado {
  ok: false;
  motivo: MotivoCondicaoFaturamento;
}

export type ResultadoFaturamento = ResultadoFaturamentoAprovado | ResultadoFaturamentoRecusado;

export interface FaixaPreco {
  idFaixaPreco: number;
  quantidadeMinima: number;
  precoUnitario: Centavos;
}

export interface ItemOrcamentoAprovado {
  idItem: number;
  granularidade: Granularidade;
  quantidadeCotada: number;
  quantidadeAprovada: number;
  precoFardo?: Centavos;
  faixas?: FaixaPreco[];
}

export interface ItemRecalculado {
  idItem: number;
  situacao: 'APROVADO' | 'NAO_APROVADO';
  quantidadeAprovada: number;
  idFaixaPrecoAceita: number | null;
  precoUnitarioAceito: Centavos | null;
  valorLinha: Centavos;
  imposto: Centavos;
  totalItem: Centavos;
}
