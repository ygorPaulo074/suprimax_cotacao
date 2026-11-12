// Item 1 do backend/TAREFAS.md — erros padronizados do backend.
// Segue o padrão da seção 12.6 (docs/12): classe AppError + catálogo código → mensagem, com
// fallback em INTERNAL_ERROR. O corpo devolvido ao frontend é sempre { codigo, mensagem, detalhes? }
// (docs/frontend-api.md, "Convenções").

/** Status HTTP usados pelo backend. */
export const STATUS_HTTP = {
  OK: 200,
  CRIADO: 201,
  SEM_CONTEUDO: 204,
  REQUISICAO_INVALIDA: 400,
  NAO_AUTENTICADO: 401,
  ACESSO_NEGADO: 403,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  CORPO_GRANDE_DEMAIS: 413,
  NAO_PROCESSAVEL: 422,
  BLOQUEADO: 423,
  REQUISICOES_DEMAIS: 429,
  ERRO_INTERNO: 500,
  SERVICO_INDISPONIVEL: 503,
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
  CREDENCIAIS_INVALIDAS: {
    status: STATUS_HTTP.NAO_AUTENTICADO,
    mensagem: 'Usuário ou senha inválidos.',
  },
  NAO_AUTENTICADO: {
    status: STATUS_HTTP.NAO_AUTENTICADO,
    mensagem: 'Sessão inexistente ou expirada. Entre novamente.',
  },
  USUARIO_INATIVO: {
    status: STATUS_HTTP.ACESSO_NEGADO,
    mensagem: 'Acesso negado: usuário inativo.',
  },
  ACESSO_NEGADO: {
    status: STATUS_HTTP.ACESSO_NEGADO,
    mensagem: 'Seu perfil não tem permissão para esta operação.',
  },
  CONTA_BLOQUEADA: {
    status: STATUS_HTTP.BLOQUEADO,
    mensagem: 'Conta bloqueada temporariamente após tentativas inválidas. Tente mais tarde.',
  },
  LIMITE_EXCEDIDO: {
    status: STATUS_HTTP.REQUISICOES_DEMAIS,
    mensagem: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.',
  },
  SERVICO_INDISPONIVEL: {
    status: STATUS_HTTP.SERVICO_INDISPONIVEL,
    mensagem: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
  },
  CLIENTE_NAO_ENCONTRADO: {
    status: STATUS_HTTP.NAO_ENCONTRADO,
    mensagem: 'Nenhum cliente cadastrado com este CNPJ.',
  },
  CLIENTE_JA_CADASTRADO: {
    status: STATUS_HTTP.CONFLITO,
    mensagem: 'Já existe um cliente cadastrado com este CNPJ.',
  },
  PRODUTO_NAO_ENCONTRADO: {
    status: STATUS_HTTP.NAO_ENCONTRADO,
    mensagem: 'Produto não encontrado.',
  },
  PRODUTO_JA_CADASTRADO: {
    status: STATUS_HTTP.CONFLITO,
    mensagem: 'Já existe um produto com este código interno ou EAN.',
  },
  REGISTRO_EM_USO: {
    status: STATUS_HTTP.CONFLITO,
    mensagem: 'O registro já foi usado em outro lançamento e não pode ser removido.',
  },
  USUARIO_NAO_ENCONTRADO: {
    status: STATUS_HTTP.NAO_ENCONTRADO,
    mensagem: 'Usuário não encontrado.',
  },
  USUARIO_JA_CADASTRADO: {
    status: STATUS_HTTP.CONFLITO,
    mensagem: 'Já existe um usuário com este nome de usuário ou e-mail.',
  },
  NOVO_VENDEDOR_OBRIGATORIO: {
    status: STATUS_HTTP.NAO_PROCESSAVEL,
    mensagem: 'Este vendedor tem clientes na carteira. Indique o novo vendedor responsável.',
  },
  VENDEDOR_COM_CARTEIRA: {
    status: STATUS_HTTP.NAO_PROCESSAVEL,
    mensagem:
      'Este vendedor tem clientes na carteira. Transfira a carteira antes de mudar o perfil.',
  },
  ALTERACAO_DO_PROPRIO_USUARIO: {
    status: STATUS_HTTP.NAO_PROCESSAVEL,
    mensagem: 'Você não pode inativar nem mudar o perfil do seu próprio usuário.',
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

/** Usuário inexistente ou senha errada (401). A mensagem é a mesma nos dois casos (UC13-E1). */
export class ErroDeCredenciaisInvalidas extends AppError {
  constructor() {
    super('CREDENCIAIS_INVALIDAS');
  }
}

/** Requisição sem sessão válida (401). O frontend encerra a sessão ao receber. */
export class ErroNaoAutenticado extends AppError {
  constructor() {
    super('NAO_AUTENTICADO');
  }
}

/** Usuário com status INATIVO (403, UC13-E3). */
export class ErroDeUsuarioInativo extends AppError {
  constructor() {
    super('USUARIO_INATIVO');
  }
}

/** Perfil sem permissão para a operação (403). */
export class ErroDeAcessoNegado extends AppError {
  /** @param mensagem Explica a restrição, quando ela vale só para parte da operação. */
  constructor(mensagem?: string) {
    super('ACESSO_NEGADO', { mensagem });
  }
}

/** Conta bloqueada após três tentativas inválidas (423, UC13-E2). */
export class ErroDeContaBloqueada extends AppError {
  /** @param bloqueadoAte Instante em que o bloqueio termina; vai em `detalhes.bloqueadoAte`. */
  constructor(bloqueadoAte: Date) {
    super('CONTA_BLOQUEADA', { detalhes: { bloqueadoAte: bloqueadoAte.toISOString() } });
  }
}

/** Excesso de requisições do mesmo endereço (429). */
export class ErroDeLimiteExcedido extends AppError {
  constructor() {
    super('LIMITE_EXCEDIDO');
  }
}

/** CNPJ sem cliente cadastrado (404, UC03-E1). A tela oferece o cadastro. */
export class ErroDeClienteNaoEncontrado extends AppError {
  constructor() {
    super('CLIENTE_NAO_ENCONTRADO');
  }
}

/** CNPJ que já pertence a outro cliente (409, UC02). */
export class ErroDeClienteJaCadastrado extends AppError {
  constructor() {
    super('CLIENTE_JA_CADASTRADO');
  }
}

/** Produto inexistente (404, UC04). */
export class ErroDeProdutoNaoEncontrado extends AppError {
  constructor() {
    super('PRODUTO_NAO_ENCONTRADO');
  }
}

/** Código interno ou EAN que já pertence a outro produto (409, UC04). */
export class ErroDeProdutoJaCadastrado extends AppError {
  /** @param campos Campos em conflito (`codigoInterno`, `ean`); vão em `detalhes.campos`. */
  constructor(campos: readonly string[]) {
    super('PRODUTO_JA_CADASTRADO', { detalhes: { campos } });
  }
}

/** Remoção de um registro que outro lançamento referencia ou que ainda tem saldo (409). */
export class ErroDeRegistroEmUso extends AppError {
  /** @param mensagem Diz ao operador qual registro não pôde ser removido e por quê. */
  constructor(mensagem: string) {
    super('REGISTRO_EM_USO', { mensagem });
  }
}

/** Usuário inexistente (404, UC25). */
export class ErroDeUsuarioNaoEncontrado extends AppError {
  constructor() {
    super('USUARIO_NAO_ENCONTRADO');
  }
}

/** Nome de usuário ou e-mail que já pertence a outro usuário (409, UC25-E2). */
export class ErroDeUsuarioJaCadastrado extends AppError {
  constructor() {
    super('USUARIO_JA_CADASTRADO');
  }
}

/** Inativação de vendedor com clientes na carteira sem o novo responsável (422, UC25-E1). */
export class ErroDeNovoVendedorObrigatorio extends AppError {
  /** @param clientesNaCarteira Quantos clientes aguardam um novo vendedor. */
  constructor(clientesNaCarteira: number) {
    super('NOVO_VENDEDOR_OBRIGATORIO', { detalhes: { clientesNaCarteira } });
  }
}

/** Mudança de perfil de vendedor que ainda tem clientes na carteira (422). */
export class ErroDeVendedorComCarteira extends AppError {
  /** @param clientesNaCarteira Quantos clientes continuam com o vendedor. */
  constructor(clientesNaCarteira: number) {
    super('VENDEDOR_COM_CARTEIRA', { detalhes: { clientesNaCarteira } });
  }
}

/** O operador chefe tentou inativar ou rebaixar a si mesmo (422). */
export class ErroDeAlteracaoDoProprioUsuario extends AppError {
  constructor() {
    super('ALTERACAO_DO_PROPRIO_USUARIO');
  }
}

/** Dependência fora do ar ou não configurada (503). */
export class ErroDeServicoIndisponivel extends AppError {
  constructor(opcoes: Pick<OpcoesDoAppError, 'causa'> = {}) {
    super('SERVICO_INDISPONIVEL', opcoes);
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
