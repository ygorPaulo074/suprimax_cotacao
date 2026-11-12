// Item 1 do backend/TAREFAS.md — log estruturado (JSON, uma linha por evento) com máscara de
// dados sensíveis. Senha, token e chaves nunca vão para o log (comunicacao-backend-proxy.md,
// seção 7).
import pino from 'pino';
import type { NivelLog } from './config';

/** Texto que substitui o valor de uma chave sensível. */
export const TEXTO_MASCARADO = '[MASCARADO]';
const TEXTO_REFERENCIA_CIRCULAR = '[CIRCULAR]';
const TEXTO_PROFUNDIDADE_EXCEDIDA = '[PROFUNDIDADE_EXCEDIDA]';

/** Além desta profundidade o conteúdo não é registrado: não dá para garantir a máscara. */
export const PROFUNDIDADE_MAXIMA_DA_MASCARA = 8;

/** Nome do serviço em cada linha de log. */
export const NOME_DO_SERVICO = 'suprimax-backend';

/**
 * Trechos que tornam uma chave sensível. A comparação ignora maiúsculas, hífens e sublinhados:
 * `senha` cobre `senhaHash` e `senha_hash`; `token` cobre `PROXY_SERVICE_TOKEN` e
 * `tokenRecuperacaoSenha`.
 */
export const TRECHOS_DE_CHAVES_SENSIVEIS: readonly string[] = [
  'senha',
  'password',
  'token',
  'authorization',
  'cookie',
  'secret',
  'segredo',
  'credencial',
  'apikey',
  'adminkey',
  'servicerolekey',
  'chaveseguranca',
];

const PADRAO_SEPARADORES_DE_CHAVE = /[^a-z0-9]/g;

/** Indica se o valor da chave deve ser mascarado no log. */
export function ehChaveSensivel(chave: string): boolean {
  const normalizada = chave.toLowerCase().replace(PADRAO_SEPARADORES_DE_CHAVE, '');
  return TRECHOS_DE_CHAVES_SENSIVEIS.some((trecho) => normalizada.includes(trecho));
}

function ehObjetoSimples(valor: unknown): valor is Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const prototipo: unknown = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function mascarar(valor: unknown, profundidade: number, visitados: WeakSet<object>): unknown {
  if (!Array.isArray(valor) && !ehObjetoSimples(valor)) {
    return valor;
  }
  if (visitados.has(valor)) {
    return TEXTO_REFERENCIA_CIRCULAR;
  }
  if (profundidade > PROFUNDIDADE_MAXIMA_DA_MASCARA) {
    return TEXTO_PROFUNDIDADE_EXCEDIDA;
  }
  visitados.add(valor);
  const copia = Array.isArray(valor)
    ? valor.map((item: unknown) => mascarar(item, profundidade + 1, visitados))
    : mascararObjeto(valor, profundidade, visitados);
  visitados.delete(valor);
  return copia;
}

function mascararObjeto(
  objeto: Record<string, unknown>,
  profundidade: number,
  visitados: WeakSet<object>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(objeto).map(([chave, item]) => [
      chave,
      ehChaveSensivel(chave) ? TEXTO_MASCARADO : mascarar(item, profundidade + 1, visitados),
    ]),
  );
}

/**
 * Devolve uma cópia do valor com as chaves sensíveis mascaradas, em qualquer nível de objetos e
 * listas. O valor original não é alterado.
 *
 * Só objetos simples e listas são percorridos; instâncias de classes (Error, Date, Buffer)
 * passam como estão.
 */
export function mascararDadosSensiveis(valor: unknown): unknown {
  return mascarar(valor, 0, new WeakSet());
}

/**
 * Serializa o erro (tipo, mensagem, stack, campos próprios e a cadeia de `cause`) em objetos
 * simples. O serializador do pino devolve objetos com protótipo próprio, que a máscara não
 * percorreria.
 */
function serializarErro(erro: Error): Record<string, unknown> {
  return copiarErroSerializado(pino.stdSerializers.errWithCause(erro));
}

function copiarErroSerializado(serializado: object): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...serializado };
  if (typeof copia.cause === 'object' && copia.cause !== null) {
    copia.cause = copiarErroSerializado(copia.cause);
  }
  return copia;
}

/** Logger do backend (pino). */
export type Logger = pino.Logger;

export interface OpcoesDoLogger {
  readonly nivel: NivelLog;
  /** Destino das linhas de log; por padrão, a saída padrão. Os testes passam um coletor. */
  readonly destino?: pino.DestinationStream;
}

/**
 * Cria o logger estruturado do backend.
 *
 * Todo objeto registrado passa pela máscara de dados sensíveis, inclusive os campos de um erro
 * registrado em `err`.
 */
export function criarLogger({ nivel, destino }: OpcoesDoLogger): Logger {
  const opcoes: pino.LoggerOptions = {
    level: nivel,
    base: { servico: NOME_DO_SERVICO },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (rotulo) => ({ level: rotulo }),
      log: (objeto) => mascararDadosSensiveis(objeto) as Record<string, unknown>,
    },
    serializers: {
      err: (erro: Error) => mascararDadosSensiveis(serializarErro(erro)),
    },
  };
  return destino ? pino(opcoes, destino) : pino(opcoes);
}
