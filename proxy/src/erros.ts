// docs/12, seções 12.6 e 12.8.6. Só códigos e mensagens corporativas chegam ao cliente: nada de
// nomes de tabelas, colunas ou mensagens do driver do banco.

export interface DefinicaoErro {
  status: number;
  mensagem: string;
}

/** Catálogo código -> status e mensagem. Todo código novo entra aqui antes de ir para produção. */
export const CATALOGO_ERROS = {
  PAYLOAD_INVALIDO: { status: 400, mensagem: 'Requisição inválida.' },
  TOKEN_INVALIDO: { status: 401, mensagem: 'Credencial ausente, inválida, expirada ou repetida.' },
  ESCOPO_NEGADO: { status: 403, mensagem: 'O integrante não tem permissão para esta operação.' },
  OPERACAO_DESCONHECIDA: { status: 404, mensagem: 'Operação desconhecida.' },
  NOT_FOUND: { status: 404, mensagem: 'Registro não encontrado.' },
  PEDIDO_JA_ASSUMIDO: { status: 409, mensagem: 'O pedido já foi assumido por outro operador.' },
  ESTOQUE_INSUFICIENTE: { status: 409, mensagem: 'Estoque insuficiente para emitir o orçamento.' },
  ORCAMENTO_NAO_EDITAVEL: { status: 409, mensagem: 'O orçamento não pode mais ser editado.' },
  CHAVE_DUPLICADA: { status: 409, mensagem: 'A chave de segurança já existe.' },
  RESPOSTA_JA_PROCESSADA: { status: 409, mensagem: 'A resposta já foi processada.' },
  RISCO_ESTRUTURAL: {
    status: 422,
    mensagem: 'Operação bloqueada pela verificação de risco estrutural.',
  },
  REGRA_DE_NEGOCIO: {
    status: 422,
    mensagem: 'A operação viola uma regra de negócio.',
  },
  LIMITE_EXCEDIDO: { status: 429, mensagem: 'Limite de requisições excedido.' },
  OPERACAO_NAO_IMPLEMENTADA: { status: 501, mensagem: 'Operação ainda não disponível.' },
  INTERNAL_ERROR: { status: 500, mensagem: 'Erro interno. Tente novamente mais tarde.' },
} as const satisfies Record<string, DefinicaoErro>;

export type CodigoErro = keyof typeof CATALOGO_ERROS;

export class AppError extends Error {
  readonly status: number;

  constructor(
    public readonly codigo: CodigoErro,
    /** Detalhes seguros para o cliente (ex.: produto e saldo no ESTOQUE_INSUFICIENTE). */
    public readonly detalhes?: Record<string, unknown>,
    /** Motivo interno, só para o log; nunca vai ao cliente. */
    public readonly motivoInterno?: string,
  ) {
    super(CATALOGO_ERROS[codigo].mensagem);
    this.name = 'AppError';
    this.status = CATALOGO_ERROS[codigo].status;
  }
}

export interface CorpoErro {
  ok: false;
  erro: { codigo: string; mensagem: string; detalhes?: Record<string, unknown> };
}

export function corpoDoErro(e: AppError): CorpoErro {
  return {
    ok: false,
    erro: {
      codigo: e.codigo,
      mensagem: CATALOGO_ERROS[e.codigo].mensagem,
      ...(e.detalhes ? { detalhes: e.detalhes } : {}),
    },
  };
}

/**
 * Códigos que as funções e os gatilhos do banco levantam com `RAISE EXCEPTION 'CODIGO'` e que não
 * têm código próprio no catálogo. Levantados nas migrations de backend/database/prisma. Chegam ao
 * cliente como REGRA_DE_NEGOCIO (422) com `detalhes.regra` = código do banco (docs/12, 12.8.6).
 */
export const REGRAS_DO_BANCO: readonly string[] = [
  'ACEITE_DEVE_USAR_OPERACAO_NOMEADA',
  'ACEITE_INCONSISTENTE',
  'APROVACAO_HERDADA_SEM_ORIGEM',
  'CLIENTE_INADIMPLENTE',
  'CLIENTE_INATIVO',
  'EMISSAO_DEVE_USAR_OPERACAO_NOMEADA',
  'ENDERECO_CLIENTE_DIVERGENTE',
  'ESTOQUE_ABAIXO_DAS_RESERVAS',
  'ESTOQUE_DEVE_SER_ALTERADO_POR_MOVIMENTACAO',
  'FAIXA_ACEITA_VARIACAO_DIVERGENTE',
  'FAIXA_VARIACAO_DIVERGENTE',
  'FARDO_VARIACAO_DIVERGENTE',
  'FATURAMENTO_MINIMO_NAO_ATINGIDO',
  'FRETE_PROVISORIO_NAO_EMITIVEL',
  'ITEM_ORCAMENTO_INVALIDO',
  'ITEM_RESPOSTA_NAO_ENCONTRADO',
  'ITEM_RESPOSTA_ORCAMENTO_DIVERGENTE',
  'LIBERADOR_NAO_E_OPERADOR_CHEFE',
  'MOTIVO_TRATAMENTO_INVALIDO',
  'MOVIMENTACAO_E_IMUTAVEL',
  'ORCAMENTO_DEVE_INICIAR_EM_RASCUNHO',
  'ORCAMENTO_NAO_ABERTO',
  'ORCAMENTO_SEM_ITENS',
  'PRAZO_PROTESTO_NAO_ATINGIDO',
  'QUANTIDADE_APROVADA_EXCEDE_COTADA',
  'QUANTIDADE_RESERVA_DIVERGENTE',
  'RESERVA_DEVE_SER_ATUALIZADA_POR_OPERACAO_NOMEADA',
  'RESERVA_FORA_DA_EMISSAO',
  'RESERVA_IMUTAVEL',
  'RESERVA_NAO_ENCONTRADA',
  'RESERVA_NAO_EXCLUIVEL',
  'RESPONSAVEL_CREDITO_NAO_E_FISCAL',
  'RESPOSTA_DEVE_CONTER_TODOS_ITENS',
  'RESPOSTA_DEVE_INICIAR_PENDENTE',
  'RESPOSTA_IMUTAVEL',
  'RESPOSTA_INCONSISTENTE',
  'RESPOSTA_NAO_EDITAVEL',
  'SITUACAO_QUANTIDADE_DIVERGENTE',
  'TOKEN_RECUPERACAO_INVALIDO',
  'TOTAL_ACEITO_DIVERGENTE',
  'TOTAL_ACEITO_OBRIGATORIO',
  'TOTAL_IMPOSTO_DIVERGENTE',
  'TOTAL_ITENS_DIVERGENTE',
  'TRANSICAO_ORCAMENTO_INVALIDA',
  'TRANSICAO_RESERVA_INVALIDA',
  'TRANSICAO_RESPOSTA_INVALIDA',
  'VENDEDOR_COM_CARTEIRA_ATIVA',
];
