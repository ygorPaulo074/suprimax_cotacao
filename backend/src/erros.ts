// Item 1 do backend/TAREFAS.md — erros padronizados do backend.
// Segue o padrão da seção 12.6 (docs/12): classe AppError + catálogo código → mensagem, com
// fallback em INTERNAL_ERROR. O corpo devolvido ao frontend é sempre { codigo, mensagem, detalhes? }
// (docs/frontend-api.md, "Convenções").

/** Status HTTP usados pelo backend. */
export const STATUS_HTTP = {
  OK: 200,
  REQUISICAO_INVALIDA: 400,
  NAO_ENCONTRADO: 404,
  CORPO_GRANDE_DEMAIS: 413,
  ERRO_INTERNO: 500,
} as const;

/** Código usado quando o erro é inesperado ou quando o código informado não está no catálogo. */
export const CODIGO_ERRO_INTERNO = 'INTERNAL_ERROR';

interface EntradaDoCatalogo {
  readonly status: number;
  /** Mensagem exibida ao operador: em português e sem detalhe interno. */
  readonly mensagem: string;
}

/**
 * Catálogo código → status HTTP e mensagem.
 *
 * Todo código novo precisa de uma entrada aqui antes de ir para produção. Um AppError criado
 * com código fora do catálogo vira INTERNAL_ERROR, para que nenhuma mensagem não revisada
 * chegue ao operador.
 */
export const CATALOGO_DE_ERROS = {
  VALIDATION_ERROR: {
    status: STATUS_HTTP.REQUISICAO_INVALIDA,
    mensagem: 'Os dados enviados são inválidos.',
  },
  NOT_FOUND: {
    status: STATUS_HTTP.NAO_ENCONTRADO,
    mensagem: 'Recurso não encontrado.',
  },
  PAYLOAD_TOO_LARGE: {
    status: STATUS_HTTP.CORPO_GRANDE_DEMAIS,
    mensagem: 'Os dados enviados excedem o tamanho permitido.',
  },
  INTERNAL_ERROR: {
    status: STATUS_HTTP.ERRO_INTERNO,
    mensagem: 'Ocorreu um erro interno. Tente novamente em instantes.',
  },
} as const satisfies Record<string, EntradaDoCatalogo>;

export type CodigoDeErro = keyof typeof CATALOGO_DE_ERROS;

/** Dados complementares do erro, devolvidos ao frontend em `detalhes`. */
export type DetalhesDoErro = Readonly<Record<string, unknown>>;

/** Corpo JSON de toda resposta de erro do backend. */
export interface CorpoDeErro {
  readonly codigo: CodigoDeErro;
  readonly mensagem: string;
  readonly detalhes?: DetalhesDoErro;
}

export interface OpcoesDoAppError {
  /**
   * Mensagem específica do caso, no lugar da mensagem do catálogo. Ela é exibida ao operador:
   * escreva em português e sem detalhe interno. Ignorada no erro interno.
   */
  readonly mensagem?: string;
  /** Dados para o frontend (ex.: `bloqueadoAte`). Nunca coloque dado interno aqui. */
  readonly detalhes?: DetalhesDoErro;
  /** Erro original. Fica só no log, nunca na resposta. */
  readonly causa?: unknown;
}

function ehCodigoDeErro(codigo: string): codigo is CodigoDeErro {
  return Object.hasOwn(CATALOGO_DE_ERROS, codigo);
}

/**
 * Erro de aplicação: carrega o código, o status HTTP e a mensagem que o frontend recebe.
 * Os módulos lançam AppError (ou uma subclasse) e o middleware de erros monta a resposta.
 */
export class AppError extends Error {
  readonly codigo: CodigoDeErro;
  readonly status: number;
  readonly detalhes?: DetalhesDoErro;
  /** Código informado na criação, quando ele não constava no catálogo. Só para o log. */
  readonly codigoOriginal?: string;

  /**
   * @param codigo Código do catálogo. Fora do catálogo, o erro vira INTERNAL_ERROR e perde a
   * mensagem e os detalhes informados.
   * @param opcoes Mensagem específica, detalhes para o frontend e erro original.
   */
  constructor(codigo: string, opcoes: OpcoesDoAppError = {}) {
    const catalogado = ehCodigoDeErro(codigo);
    const codigoFinal = catalogado ? codigo : CODIGO_ERRO_INTERNO;
    const interno = codigoFinal === CODIGO_ERRO_INTERNO;
    const entrada: EntradaDoCatalogo = CATALOGO_DE_ERROS[codigoFinal];

    super(interno ? entrada.mensagem : (opcoes.mensagem ?? entrada.mensagem), {
      cause: opcoes.causa,
    });
    this.name = new.target.name;
    this.codigo = codigoFinal;
    this.status = entrada.status;
    if (!interno && opcoes.detalhes !== undefined) {
      this.detalhes = opcoes.detalhes;
    }
    if (!catalogado) {
      this.codigoOriginal = codigo;
    }
  }

  /** Monta o corpo JSON da resposta. Só expõe código, mensagem e detalhes. */
  paraCorpo(): CorpoDeErro {
    return {
      codigo: this.codigo,
      mensagem: this.message,
      ...(this.detalhes !== undefined && { detalhes: this.detalhes }),
    };
  }
}

/** Dados da requisição fora do formato esperado (400). */
export class ErroDeValidacao extends AppError {
  constructor(opcoes: OpcoesDoAppError = {}) {
    super('VALIDATION_ERROR', opcoes);
  }
}

/** Rota ou registro inexistente (404). */
export class ErroNaoEncontrado extends AppError {
  constructor(opcoes: OpcoesDoAppError = {}) {
    super('NOT_FOUND', opcoes);
  }
}

/** Falha inesperada (500). O frontend recebe só a mensagem genérica; a causa vai para o log. */
export class ErroInterno extends AppError {
  constructor(causa?: unknown) {
    super(CODIGO_ERRO_INTERNO, { causa });
  }
}

/**
 * Garante um AppError: devolve o próprio erro se já for um, ou o embrulha em ErroInterno.
 *
 * @param erro Qualquer valor capturado em um `catch`.
 */
export function normalizarErro(erro: unknown): AppError {
  return erro instanceof AppError ? erro : new ErroInterno(erro);
}
