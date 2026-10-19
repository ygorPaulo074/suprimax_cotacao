export type Centavos = number; // inteiro >= 0
export type DataISO = string; // 'AAAA-MM-DD'
export type ResultadoCredito = 'APROVADO' | 'REPROVADO' | null; // null = análise pendente
export type Granularidade = 'FARDO' | 'AVULSO';
export type CondicaoPagamento = 'ADIANTADO_100' | 'BOLETO' | 'PARCELADO' | 'ADIANTADO_50_50';
export type OrigemTransportadora = 'SUPRIMAX' | 'CLIENTE';
