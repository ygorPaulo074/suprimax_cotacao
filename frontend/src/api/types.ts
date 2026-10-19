// Contrato de dados entre o frontend e o backend do Sistema 2 (docs/10, 11 e 13).
// Convenções (iguais às do módulo de cálculo, docs/11 seção 11.6.2.1):
//  - dinheiro: inteiro em centavos (Centavos); o frontend só formata na exibição;
//  - datas: 'AAAA-MM-DD' (DataISO) ou timestamp ISO 8601 (DataHoraISO);
//  - campos em camelCase, derivados do dicionário de dados (docs/banco-de-dados).
// O backend traduz DECIMAL(12,2) <-> centavos e snake_case <-> camelCase.

export type Centavos = number;
export type DataISO = string;
export type DataHoraISO = string;

// ---- Enumerações (valores literais do banco, docs/10 seção 10.4) ----
export type Perfil =
  'VENDEDOR' | 'OPERADOR' | 'OPERADOR_CHEFE' | 'FISCAL' | 'FINANCEIRO' | 'GESTOR';
export type StatusUsuario = 'ATIVO' | 'INATIVO';
export type StatusCliente = 'ATIVO' | 'INATIVO' | 'BLOQUEADO';
export type TipoUnidade = 'MATRIZ' | 'FILIAL';
export type TipoEndereco = 'CADASTRAL' | 'ENTREGA';
export type StatusPedido = 'SOLICITADO' | 'EM_ANALISE' | 'APROVADO' | 'NEGADO' | 'CANCELADO';
export type StatusOrcamento =
  | 'RASCUNHO'
  | 'PENDENTE_CREDITO'
  | 'ABERTO'
  | 'ALTERACAO_SOLICITADA'
  | 'ACEITO'
  | 'RECUSADO'
  | 'CANCELADO'
  | 'SUBSTITUIDO'
  | 'EXPIRADO';
export type SituacaoItem = 'APROVADO' | 'NAO_APROVADO';
export type TipoRespostaPendente =
  'RECUSA' | 'ALTERACAO' | 'ITENS_NAO_APROVADOS' | 'ABAIXO_DO_MINIMO';
export type StatusDivida = 'EM_ABERTO' | 'RENEGOCIADA' | 'QUITADA' | 'PROTESTADA';
export type Granularidade = 'FARDO' | 'AVULSO';
export type CondicaoPagamento = 'ADIANTADO_100' | 'BOLETO' | 'PARCELADO' | 'ADIANTADO_50_50';
export type ModalidadeFrete = 'CIF' | 'FOB';
export type OrigemTransportadora = 'SUPRIMAX' | 'CLIENTE';
export type ResultadoCredito = 'APROVADO' | 'REPROVADO';
export type TipoMovimentacao = 'ENTRADA' | 'BAIXA' | 'AJUSTE' | 'ESTORNO';
export type TipoAnexo = 'DESCRITIVO_TECNICO' | 'MATERIAL_APOIO';
export type TipoDocumentoCredito =
  | 'CONTRATO_SOCIAL'
  | 'BALANCO_LUCRO'
  | 'COMPROVANTE_ENDERECO'
  | 'DOCUMENTO_PROPRIETARIO'
  | 'NOTA_FISCAL_COMPRA'
  | 'REFERENCIA_COMERCIAL';

// ---- Autenticação (UC13) ----
export interface Sessao {
  idOperador: number;
  usuario: string;
  nome: string;
  email: string;
  perfil: Perfil;
}
export interface LoginRequest {
  usuario: string;
  senha: string;
}
export interface LoginResponse {
  token: string;
  usuario: Sessao;
}

// ---- Paginação e listas ----
export interface Pagina<T> {
  itens: T[];
  total: number;
}

// ---- Pedidos (UC10) ----
export interface IndicadoresPedidos {
  aguardandoAnalise: number;
  emAnalise: number;
  orcamentosEmAberto: number;
  pendentesCredito: number;
}
export interface PedidoResumo {
  idPedido: number;
  numero: string; // exibição, ex.: 'PED-0421'
  idCliente: number;
  cliente: string;
  cnpj: string;
  vendedor: string;
  dataSolicitacao: DataHoraISO;
  quantidadeItens: number;
  status: StatusPedido;
  /** Operador que assumiu o pedido (quando EM_ANALISE). */
  operadorAtendimento: string | null;
  /** true quando EM_ANALISE por outro operador (a ação Selecionar não é exibida). */
  assumidoPorOutro: boolean;
}
export interface PedidoItem {
  idItemPedido: number;
  produto: string;
  marca: string;
  embalagem: string;
  granularidade: Granularidade;
  quantidadeSolicitada: number;
  saldoDisponivel: number;
}
export interface SituacaoCliente {
  creditoAprovado: boolean | null; // null = sem análise
  limiteCredito: Centavos | null;
  dividaEmAberto: Centavos;
  primeiraCompra: boolean;
}
export interface PedidoDetalhe extends PedidoResumo {
  itens: PedidoItem[];
  enderecoEntrega: string | null;
  numeroSolicitacaoCompra: string | null;
  contato: string | null;
  condicaoPagamentoDesejada: CondicaoPagamento | null;
  prazoDiasDesejado: number | null;
  numeroParcelasDesejado: number | null;
  transportadoraIndicada: string | null;
  observacoes: string | null;
  situacaoCliente: SituacaoCliente;
}

// ---- Clientes (UC02, UC03) ----
export interface EnderecoCliente {
  idEndereco?: number;
  tipo: TipoEndereco;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}
export interface ClienteFicha {
  idCliente: number;
  cnpj: string;
  razaoSocial: string;
  nomeContato: string;
  telefoneContato: string | null;
  emailContato: string | null;
  tipoUnidade: TipoUnidade;
  status: StatusCliente;
  vendedorResponsavel: string;
  enderecos: EnderecoCliente[];
  /** Dívida em aberto e não renegociada bloqueia novos orçamentos. */
  dividaEmAberto: Centavos;
}
export interface ClienteNovo {
  cnpj: string;
  razaoSocial: string;
  nomeContato: string;
  telefoneContato?: string;
  emailContato?: string;
  tipoUnidade: TipoUnidade;
  idOperadorVendedor: number;
  enderecos: EnderecoCliente[];
  aceiteLgpd: true;
}
export interface HistoricoCompra {
  idOrcamento: number;
  numeroOrcamento: number;
  dataEmissao: DataISO;
  valorTotalAceito: Centavos;
}
export interface VendedorOpcao {
  idOperador: number;
  nome: string;
}

// ---- Produtos e estoque (UC04, UC15, UC24) ----
export interface FaixaPreco {
  idFaixaPreco: number;
  quantidadeMinima: number;
  precoUnitario: Centavos;
}
export interface Fardo {
  idFardo: number;
  quantidadeUnidades: number;
  precoFixo: Centavos;
}
export interface VariacaoProduto {
  idVariacao: number;
  marca: string;
  tamanhoEmbalagem: string;
  quantidadeEstoque: number;
  /** Físico menos reservas CONFIRMADA (RN14). */
  saldoDisponivel: number;
  faixasPreco: FaixaPreco[];
  fardos: Fardo[];
}
export interface Produto {
  idProduto: number;
  codigoInterno: string;
  descricao: string;
  ncm: string | null;
  ean: string | null;
  categoria: string | null;
  ativo: boolean;
  variacoes: VariacaoProduto[];
}
export interface ProdutoSalvar {
  codigoInterno: string;
  descricao: string;
  ncm?: string;
  ean?: string;
  categoria?: string;
  ativo: boolean;
  variacoes: {
    idVariacao?: number;
    marca: string;
    tamanhoEmbalagem: string;
    /** Somente leitura após o cadastro; ajustes passam pelo UC24. */
    quantidadeEstoque?: number;
    /** Faixas e fardos só são aceitos de OPERADOR_CHEFE. */
    faixasPreco?: Omit<FaixaPreco, 'idFaixaPreco'>[];
    fardos?: Omit<Fardo, 'idFardo'>[];
  }[];
}
export interface BuscaProdutoParams {
  q?: string; // descrição, código interno ou EAN
  marca?: string;
  tamanhoEmbalagem?: string;
  categoria?: string;
  /** Preço sempre pela tabela do cliente (RN07); itens sem preço não retornam (RN08). */
  idCliente: number;
}
export interface SaldoEstoque {
  idVariacao: number;
  produto: string;
  marca: string;
  tamanhoEmbalagem: string;
  saldoFisico: number;
  reservado: number;
  disponivel: number;
}
export interface MovimentacaoEstoque {
  idMovimentacao: number;
  tipo: TipoMovimentacao;
  quantidade: number;
  usuario: string | null;
  motivo: string | null;
  dataMovimentacao: DataHoraISO;
}
export interface AjusteEstoque {
  /** Positivo soma, negativo subtrai. */
  quantidade: number;
  motivo: string; // obrigatório
}

// ---- Orçamentos (UC01, UC05, UC06, UC08, UC14–UC19) ----
export interface OrcamentoResumo {
  idOrcamento: number;
  numeroOrcamento: number | null; // null em rascunho
  idCliente: number;
  cliente: string;
  cnpj: string;
  dataEmissao: DataISO | null;
  dataValidade: DataISO | null;
  diasParaVencer: number | null;
  valorTotalProposta: Centavos | null;
  status: StatusOrcamento;
}
export interface FiltroOrcamentos {
  status?: StatusOrcamento;
  cliente?: string;
  cnpj?: string;
  numero?: string;
  de?: DataISO;
  ate?: DataISO;
}
export interface ItemOrcamento {
  idItem: number;
  idVariacao: number;
  produto: string;
  marca: string;
  embalagem: string;
  granularidade: Granularidade;
  /** quantidade_fardos (FARDO) ou quantidade_avulsa (AVULSO). */
  quantidade: number;
  precoUnitarioAplicado: Centavos;
  valorLinha: Centavos;
  valorImposto: Centavos;
  valorTotalItem: Centavos;
  /** Só existe após a emissão (aprovação por item). */
  situacao?: SituacaoItem;
  aprovacaoHerdada: boolean;
}
export interface Anexo {
  idAnexo: number;
  tipoAnexo: TipoAnexo;
  nomeArquivo: string;
}
export interface CondicoesComerciais {
  valorTotalItens: Centavos; // soma dos totais das linhas (com imposto, sem frete)
  valorTotalImposto: Centavos;
  modalidadeFrete: ModalidadeFrete | null;
  origemTransportadora: OrigemTransportadora | null;
  transportadora: string | null;
  valorFrete: Centavos | null;
  freteProvisorio: boolean;
  condicaoPagamento: CondicaoPagamento | null;
  /** Formas de pagamento que o backend permite para este orçamento (primeira compra, crédito, valor). */
  condicoesPagamentoPermitidas: CondicaoPagamento[];
  prazoDias: number | null;
  numeroParcelas: number | null;
  valorTotalProposta: Centavos;
  creditoStatus: 'NAO_EXIGIDO' | 'PENDENTE' | 'APROVADO' | 'REPROVADO';
  /** Motivos que bloqueiam a emissão; a tela os exibe em alerta laranja com o texto recebido. */
  bloqueios: BloqueioEmissao[];
}
export interface BloqueioEmissao {
  codigo:
    | 'ABAIXO_DO_MINIMO'
    | 'PENDENTE_CREDITO'
    | 'DIVIDA_EM_ABERTO'
    | 'ESTOQUE_INSUFICIENTE'
    | 'CLIENTE_BLOQUEADO'
    | 'SEM_ITENS';
  mensagem: string;
}
export interface EventoHistorico {
  tipoEvento: 'MUDANCA_STATUS' | 'ATUALIZACAO_FOLLOWUP';
  statusAnterior: StatusOrcamento | null;
  statusNovo: StatusOrcamento;
  observacao: string | null;
  usuario: string | null;
  dataRegistro: DataHoraISO;
}
export interface VersaoOrcamento {
  idOrcamento: number;
  numeroOrcamento: number | null;
  status: StatusOrcamento;
}
export interface OrcamentoDetalhe {
  idOrcamento: number;
  numeroOrcamento: number | null;
  status: StatusOrcamento;
  idCliente: number;
  cliente: string;
  cnpj: string;
  idPedido: number | null;
  numeroPedido: string | null;
  dataEmissao: DataISO | null;
  dataValidade: DataISO | null;
  chaveSeguranca: string | null;
  numeroSolicitacaoCompra: string | null;
  contato: string | null;
  idEnderecoEntrega: number | null;
  enderecosEntrega: EnderecoCliente[];
  prazoEntregaDias: number | null;
  itens: ItemOrcamento[];
  anexos: Anexo[];
  condicoes: CondicoesComerciais;
  historico: EventoHistorico[];
  versoes: VersaoOrcamento[];
}
export interface OrcamentoCabecalhoAtualizar {
  numeroSolicitacaoCompra?: string | null;
  contato?: string | null;
  idEnderecoEntrega?: number | null;
  prazoEntregaDias?: number | null;
}
export interface CondicoesAtualizar {
  condicaoPagamento?: CondicaoPagamento;
  prazoDias?: number;
  numeroParcelas?: number;
  origemTransportadora?: OrigemTransportadora;
  transportadora?: string;
  /** Valor cotado com a transportadora (FOB, origem SUPRIMAX); ausente = frete provisório. */
  valorFrete?: Centavos;
}
export interface ItemAdicionar {
  idVariacao: number;
  granularidade: Granularidade;
  idFardo?: number;
  quantidade: number;
}

// ---- Respostas pendentes (UC20, UC21) ----
export interface RespostaPendenteResumo {
  idResposta: number;
  idOrcamento: number;
  numeroOrcamento: number;
  cliente: string;
  vendedor: string;
  tipo: TipoRespostaPendente;
  dataResposta: DataHoraISO;
}
export interface FiltroRespostas {
  tipo?: TipoRespostaPendente;
  idVendedor?: number;
}
export interface ItemRespostaDetalhe {
  idItem: number;
  produto: string;
  situacao: SituacaoItem;
  quantidadeCotada: number;
  quantidadeAprovada: number;
  valorTotalItemAceito: Centavos | null;
}
export interface RespostaPendenteDetalhe extends RespostaPendenteResumo {
  justificativa: string | null; // pode ser vazia
  itensOriginal: ItemRespostaDetalhe[];
  valorTotalAceito: Centavos | null;
  /** Rascunho da nova versão, criado a partir do original com os itens copiados. */
  novaVersao: OrcamentoDetalhe;
}

// ---- Crédito (UC07) ----
export interface DocumentoCredito {
  tipoDocumento: TipoDocumentoCredito;
  recebido: boolean;
  dataRecebimento: DataISO | null;
}
export interface AnaliseCreditoResumo {
  idAnalise: number;
  cliente: string;
  cnpj: string;
  numeroOrcamento: number | null;
  dataSolicitacao: DataISO;
  resultado: ResultadoCredito | null;
}
export interface AnaliseCreditoDetalhe extends AnaliseCreditoResumo {
  valorCompra: Centavos | null;
  documentos: DocumentoCredito[];
}

// ---- Dívidas (UC23) ----
export interface Divida {
  idDivida: number;
  idCliente: number;
  cliente: string;
  valorDivida: Centavos;
  dataVencimentoOriginal: DataISO;
  status: StatusDivida;
  dataRenegociacao: DataISO | null;
  valorPagoRenegociacao: Centavos | null;
  dataProtesto: DataISO | null;
}
export interface DividaNova {
  idCliente: number;
  valorDivida: Centavos;
  dataVencimentoOriginal: DataISO;
}
export interface Renegociacao {
  dataRenegociacao: DataISO;
  /** Mínimo de 50% da dívida (CHECK do banco). */
  valorPago: Centavos;
}

// ---- Fornecedores e entrada de mercadoria (UC04, UC22) ----
export interface Fornecedor {
  idFornecedor: number;
  cnpj: string;
  razaoSocial: string;
  nomeContato: string | null;
  telefoneContato: string | null;
  emailContato: string | null;
}
export type FornecedorNovo = Omit<Fornecedor, 'idFornecedor'>;
export interface EntradaMercadoriaNova {
  idFornecedor: number;
  idVariacao: number;
  numeroCotacaoCompra?: string;
  quantidadeComprada: number;
  quantidadeInformada: number;
  /** Liberação de divergência por OPERADOR_CHEFE, com credenciais próprias (RF19). */
  liberacao?: { usuario: string; senha: string };
}

// ---- Usuários (UC25) ----
export interface Usuario {
  idOperador: number;
  usuario: string;
  email: string;
  perfil: Perfil;
  status: StatusUsuario;
  clientesNaCarteira: number;
}
export interface UsuarioNovo {
  usuario: string;
  email: string;
  perfil: Perfil;
}
export interface UsuarioAtualizar {
  perfil?: Perfil;
  status?: StatusUsuario;
  /** Obrigatório ao inativar vendedor com clientes na carteira. */
  idNovoVendedor?: number;
}

// ---- Erros ----
export interface ErroApi {
  codigo: string; // ex.: 'CREDENCIAIS_INVALIDAS', 'CONTA_BLOQUEADA', 'PEDIDO_JA_ASSUMIDO'
  mensagem: string;
  detalhes?: Record<string, unknown>;
}
