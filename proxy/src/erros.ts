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
