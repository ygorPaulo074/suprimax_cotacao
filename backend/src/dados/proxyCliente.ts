// Item 2 do backend/TAREFAS.md — cliente do proxy: o único ponto do backend que lê e grava no
// banco (RNF05). Segue backend/comunicacao-backend-proxy.md e docs/12, seções 12.2, 12.3 e 12.8.
import { VARIAVEIS_DO_PROXY, type Config } from '../config';
import type { Logger } from '../log';
import { ErroDeServicoIndisponivel } from '../erros';
import { converterChavesParaCamelCase } from './conversao';
import { CODIGOS_DO_PROXY, traduzirErroDeProxy } from './traducaoDeErros';

/** Rota única do proxy (docs/12, seção 12.2). */
export const ROTA_EXECUTAR = '/executar';

/** Cabeçalhos obrigatórios em toda requisição ao proxy (docs/12, seção 12.3). */
export const CABECALHOS_DO_PROXY = {
  AUTORIZACAO: 'Authorization',
  ID_DO_SERVICO: 'X-Service-Id',
  TIMESTAMP: 'X-Timestamp',
  ID_DA_OPERACAO: 'X-Operation-Id',
} as const;

/** Leituras: as únicas operações que o cliente repete sozinho, porque repetir não altera dados. */
export const OPERACOES_DE_LEITURA: ReadonlySet<string> = new Set(['dados.consultar']);

/** Operação cujo retorno é indexado pelo id de cada passo, que não é nome de coluna. */
const OPERACAO_LOTE = 'dados.lote';

/** Prazo de uma tentativa, incluindo a leitura do corpo da resposta. */
export const TEMPO_LIMITE_PADRAO_MS = 10_000;
/** Total de tentativas de uma leitura (a primeira mais as repetições). */
export const MAXIMO_DE_TENTATIVAS_DE_LEITURA = 3;
/** Espera antes da primeira repetição; dobra a cada nova repetição. */
export const ESPERA_INICIAL_PADRAO_MS = 200;
const FATOR_DE_CRESCIMENTO_DA_ESPERA = 2;

/** Falhas que acontecem antes de existir uma resposta válida do proxy, com o status equivalente. */
export const FALHAS_DE_COMUNICACAO = {
  FALHA_DE_REDE: { codigo: 'FALHA_DE_REDE', status: 503, mensagem: 'O proxy não respondeu.' },
  TEMPO_ESGOTADO: {
    codigo: 'TEMPO_ESGOTADO',
    status: 504,
    mensagem: 'O proxy demorou demais para responder.',
  },
  RESPOSTA_INVALIDA: {
    codigo: 'RESPOSTA_INVALIDA',
    status: 502,
    mensagem: 'O proxy devolveu uma resposta fora do formato esperado.',
  },
} as const;

/** Status em que vale a pena repetir uma leitura: excesso de requisições e falhas passageiras. */
const STATUS_TRANSITORIOS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

const NOMES_DE_ERRO_DE_PRAZO: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError']);
const TIPO_DO_CONTEUDO = 'application/json';

/** Erro devolvido pelo proxy, ou falha de comunicação com ele. */
export class ErroProxy extends Error {
  /**
   * @param status Status HTTP da resposta (ou o equivalente, nas falhas de comunicação).
   * @param codigo Código do proxy (docs/12, seção 12.8.6) ou de FALHAS_DE_COMUNICACAO.
   * @param mensagem Mensagem do proxy. Não a repasse ao frontend sem revisar.
   * @param detalhes Dados do erro (ex.: produto e saldo em ESTOQUE_INSUFICIENTE).
   */
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly detalhes?: Readonly<Record<string, unknown>>,
    opcoes?: ErrorOptions,
  ) {
    super(mensagem, opcoes);
    this.name = 'ErroProxy';
  }

  /** Indica se repetir a mesma requisição pode dar certo. */
  get ehTransitorio(): boolean {
    return STATUS_TRANSITORIOS.has(this.status);
  }
}

/** O cliente foi criado sem as variáveis de ambiente do proxy. */
export class ProxyNaoConfiguradoError extends Error {
  constructor(public readonly variaveis: readonly string[]) {
    super(`Acesso ao proxy não configurado. Defina: ${variaveis.join(', ')}.`);
    this.name = 'ProxyNaoConfiguradoError';
  }
}

type ConfigDeAcessoAoProxy = Pick<Config, 'proxyUrl' | 'proxyServiceId' | 'proxyServiceToken'>;

/** Nomes das variáveis de acesso ao proxy que não foram informadas. */
export function variaveisDoProxyAusentes(config: ConfigDeAcessoAoProxy): string[] {
  const informadas = [config.proxyUrl, config.proxyServiceId, config.proxyServiceToken];
  return VARIAVEIS_DO_PROXY.filter((_nome, indice) => informadas[indice] === undefined);
}

/** Corpo de sucesso do proxy, com as chaves já em camelCase. Cada operação define seus campos. */
export interface RespostaDoProxy {
  readonly ok: true;
  readonly dados?: unknown;
  readonly afetados?: number;
  readonly proximoCursor?: string | null;
  readonly resultados?: Readonly<Record<string, unknown>>;
  readonly resultado?: unknown;
}

/**
 * Contrato da camada de acesso a dados. Os repositórios dependem desta interface, e não da classe
 * concreta, para que os testes troquem o proxy por um dublê (`src/testing/proxyClienteFalso.ts`).
 */
export interface ClienteDeProxy {
  /**
   * Executa uma operação do catálogo do proxy (docs/12, seção 12.8).
   *
   * @param operacao Identificador da operação (ex.: `dados.consultar`, `pedido.assumir`).
   * @param payload Dados da operação, no formato do catálogo: nomes de tabelas e colunas em
   * snake_case. Para os `valores` de uma gravação, use `converterChavesParaSnakeCase`.
   * @param operationId Identifica o processo na auditoria do proxy (ex.: `UC13-login`).
   * @returns O corpo de sucesso, com as chaves em camelCase. Valores DECIMAL continuam em texto:
   * quem conhece a coluna aplica `decimalParaCentavos`.
   * @throws {ErroProxy} Nos erros que dependem da operação (conflito de estado, não encontrado).
   * @throws {AppError} Nos demais: validação (PAYLOAD_INVALIDO) ou erro interno.
   */
  executar<T = RespostaDoProxy>(
    operacao: string,
    payload: Readonly<Record<string, unknown>>,
    operationId: string,
  ): Promise<T>;
}

/** Endereço e credencial do integrante Sistema 2 no proxy. */
export interface ConfigDoProxy {
  readonly url: string;
  readonly serviceId: string;
  readonly token: string;
}

/** Ajustes e dependências substituíveis do cliente. Os padrões servem para produção. */
export interface OpcoesDoClienteProxy {
  readonly tempoLimiteMs?: number;
  readonly maximoDeTentativasDeLeitura?: number;
  readonly esperaInicialMs?: number;
  /** Função de requisição HTTP; por padrão, o `fetch` do Node. */
  readonly fetch?: typeof fetch;
  /** Pausa entre tentativas; por padrão, `setTimeout`. */
  readonly esperar?: (ms: number) => Promise<void>;
  /** Relógio usado no X-Timestamp; por padrão, a hora do sistema. */
  readonly agora?: () => Date;
}

interface Requisicao {
  readonly operacao: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly operationId: string;
}

function esperarComTemporizador(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Cliente HTTP do proxy.
 *
 * Em cada tentativa envia um X-Timestamp novo, porque o proxy rejeita requisição repetida
 * (proteção contra replay). Repete sozinho só o que é seguro repetir:
 * - TOKEN_INVALIDO: uma vez, em qualquer operação — o proxy recusou antes de executar;
 * - falha passageira (rede, prazo, 429, 5xx): apenas em leituras, com espera crescente.
 *
 * Gravação que falha nunca é repetida aqui: se a resposta se perdeu, a gravação pode ter
 * acontecido, e quem chamou precisa ler o estado antes de tentar de novo.
 */
export class ClienteProxy implements ClienteDeProxy {
  private readonly tempoLimiteMs: number;
  private readonly maximoDeTentativasDeLeitura: number;
  private readonly esperaInicialMs: number;
  private readonly fetch: typeof fetch;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly agora: () => Date;
  private ultimoTimestampMs = 0;

  constructor(
    private readonly config: ConfigDoProxy,
    private readonly logger: Logger,
    opcoes: OpcoesDoClienteProxy = {},
  ) {
    this.tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
    this.maximoDeTentativasDeLeitura =
      opcoes.maximoDeTentativasDeLeitura ?? MAXIMO_DE_TENTATIVAS_DE_LEITURA;
    this.esperaInicialMs = opcoes.esperaInicialMs ?? ESPERA_INICIAL_PADRAO_MS;
    this.fetch = opcoes.fetch ?? ((...argumentos) => fetch(...argumentos));
    this.esperar = opcoes.esperar ?? esperarComTemporizador;
    this.agora = opcoes.agora ?? (() => new Date());
  }

  /**
   * Cria o cliente a partir da configuração do backend.
   *
   * @throws {ProxyNaoConfiguradoError} Se faltar PROXY_URL, PROXY_SERVICE_ID ou PROXY_SERVICE_TOKEN.
   */
  static aPartirDaConfig(
    config: ConfigDeAcessoAoProxy,
    logger: Logger,
    opcoes?: OpcoesDoClienteProxy,
  ): ClienteProxy {
    const { proxyUrl, proxyServiceId, proxyServiceToken } = config;
    if (proxyUrl === undefined || proxyServiceId === undefined || proxyServiceToken === undefined) {
      throw new ProxyNaoConfiguradoError(variaveisDoProxyAusentes(config));
    }
    return new ClienteProxy(
      { url: proxyUrl, serviceId: proxyServiceId, token: proxyServiceToken },
      logger,
      opcoes,
    );
  }

  async executar<T = RespostaDoProxy>(
    operacao: string,
    payload: Readonly<Record<string, unknown>>,
    operationId: string,
  ): Promise<T> {
    const requisicao: Requisicao = { operacao, payload, operationId };
    const maximoDeTentativas = OPERACOES_DE_LEITURA.has(operacao)
      ? this.maximoDeTentativasDeLeitura
      : 1;
    let tentativa = 1;
    let renovouTimestamp = false;

    for (;;) {
      try {
        return (await this.enviar(requisicao)) as T;
      } catch (erro) {
        if (!(erro instanceof ErroProxy)) {
          throw erro;
        }
        this.registrarFalha(requisicao, erro, tentativa);
        if (erro.codigo === CODIGOS_DO_PROXY.TOKEN_INVALIDO && !renovouTimestamp) {
          renovouTimestamp = true;
        } else if (erro.ehTransitorio && tentativa < maximoDeTentativas) {
          await this.esperar(this.esperaAntesDaRepeticao(tentativa));
          tentativa += 1;
        } else {
          throw traduzirErroDeProxy(erro) ?? erro;
        }
      }
    }
  }

  /** Faz uma tentativa: envia, lê o corpo dentro do prazo e separa sucesso de erro. */
  private async enviar({ operacao, payload, operationId }: Requisicao): Promise<unknown> {
    let resposta: Response;
    let texto: string;
    try {
      resposta = await this.fetch(`${this.config.url}${ROTA_EXECUTAR}`, {
        method: 'POST',
        headers: this.montarCabecalhos(operationId),
        body: JSON.stringify({ operacao, payload }),
        signal: AbortSignal.timeout(this.tempoLimiteMs),
      });
      texto = await resposta.text();
    } catch (erro) {
      throw this.criarFalhaDeComunicacao(erro);
    }
    return this.interpretar(operacao, resposta.status, texto);
  }

  private montarCabecalhos(operationId: string): Record<string, string> {
    return {
      'Content-Type': TIPO_DO_CONTEUDO,
      [CABECALHOS_DO_PROXY.AUTORIZACAO]: `Bearer ${this.config.token}`,
      [CABECALHOS_DO_PROXY.ID_DO_SERVICO]: this.config.serviceId,
      [CABECALHOS_DO_PROXY.TIMESTAMP]: this.proximoTimestamp(),
      [CABECALHOS_DO_PROXY.ID_DA_OPERACAO]: operationId,
    };
  }

  /**
   * Horário atual em ISO 8601, sempre maior que o anterior. Duas requisições iguais no mesmo
   * milissegundo teriam o mesmo timestamp, e o proxy recusaria a segunda como repetida.
   */
  private proximoTimestamp(): string {
    this.ultimoTimestampMs = Math.max(this.agora().getTime(), this.ultimoTimestampMs + 1);
    return new Date(this.ultimoTimestampMs).toISOString();
  }

  private interpretar(operacao: string, status: number, texto: string): unknown {
    let corpo: unknown;
    try {
      corpo = JSON.parse(texto);
    } catch {
      throw this.criarErroDeRespostaInvalida(status);
    }
    if (ehObjeto(corpo) && corpo.ok === true) {
      return this.converterSucesso(operacao, corpo);
    }
    if (ehObjeto(corpo) && corpo.ok === false && ehObjeto(corpo.erro)) {
      const { codigo, mensagem, detalhes } = corpo.erro;
      if (typeof codigo === 'string') {
        return this.lancarErroDoProxy(status, codigo, mensagem, detalhes);
      }
    }
    throw this.criarErroDeRespostaInvalida(status);
  }

  private lancarErroDoProxy(
    status: number,
    codigo: string,
    mensagem: unknown,
    detalhes: unknown,
  ): never {
    throw new ErroProxy(
      status,
      codigo,
      typeof mensagem === 'string' ? mensagem : codigo,
      ehObjeto(detalhes) ? detalhes : undefined,
    );
  }

  /** Em `dados.lote`, as chaves de `resultados` são os ids dos passos e ficam como estão. */
  private converterSucesso(operacao: string, corpo: Record<string, unknown>): unknown {
    if (operacao !== OPERACAO_LOTE || !ehObjeto(corpo.resultados)) {
      return converterChavesParaCamelCase(corpo);
    }
    const { resultados, ...demais } = corpo;
    return {
      ...(converterChavesParaCamelCase(demais) as Record<string, unknown>),
      resultados: Object.fromEntries(
        Object.entries(resultados).map(([passo, retorno]) => [
          passo,
          converterChavesParaCamelCase(retorno),
        ]),
      ),
    };
  }

  private criarFalhaDeComunicacao(erro: unknown): ErroProxy {
    // Compara pelo nome, sem `instanceof`: o erro de prazo é um DOMException, que nem sempre
    // herda do mesmo `Error` deste módulo.
    const nome: unknown = ehObjeto(erro) ? erro.name : undefined;
    const prazoEsgotado = typeof nome === 'string' && NOMES_DE_ERRO_DE_PRAZO.has(nome);
    const { status, codigo, mensagem } = prazoEsgotado
      ? FALHAS_DE_COMUNICACAO.TEMPO_ESGOTADO
      : FALHAS_DE_COMUNICACAO.FALHA_DE_REDE;
    return new ErroProxy(status, codigo, mensagem, undefined, { cause: erro });
  }

  private criarErroDeRespostaInvalida(statusRecebido: number): ErroProxy {
    const { status, codigo, mensagem } = FALHAS_DE_COMUNICACAO.RESPOSTA_INVALIDA;
    return new ErroProxy(status, codigo, mensagem, { statusRecebido });
  }

  private esperaAntesDaRepeticao(tentativa: number): number {
    return this.esperaInicialMs * FATOR_DE_CRESCIMENTO_DA_ESPERA ** (tentativa - 1);
  }

  /** Registra a falha sem o corpo da requisição nem a credencial. */
  private registrarFalha(
    { operacao, operationId }: Requisicao,
    erro: ErroProxy,
    tentativa: number,
  ) {
    this.logger.warn(
      {
        operacao,
        operationId,
        tentativa,
        status: erro.status,
        codigo: erro.codigo,
        detalhes: erro.detalhes,
      },
      'falha na chamada ao proxy',
    );
  }
}

/**
 * Substituto do cliente quando o acesso ao proxy não foi configurado (só acontece em dev): toda
 * operação responde 503 SERVICO_INDISPONIVEL, e o restante do servidor continua de pé.
 */
export class ClienteDeProxyIndisponivel implements ClienteDeProxy {
  executar<T = RespostaDoProxy>(): Promise<T> {
    return Promise.reject(
      new ErroDeServicoIndisponivel({ causa: new ProxyNaoConfiguradoError(VARIAVEIS_DO_PROXY) }),
    );
  }
}
