// Item 1 do backend/TAREFAS.md — configuração por variáveis de ambiente (docs/03, seção 3.2).
// As variáveis são lidas e validadas uma única vez, na subida. O restante do código recebe o
// objeto Config pronto e nunca lê process.env diretamente.
import { z } from 'zod';

/** Ambientes de execução aceitos na variável ENV. */
export const AMBIENTES = ['dev', 'homologacao', 'producao'] as const;
export type Ambiente = (typeof AMBIENTES)[number];

/** Níveis de log aceitos na variável LOG_LEVEL (os mesmos do pino). */
export const NIVEIS_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type NivelLog = (typeof NIVEIS_LOG)[number];

export const AMBIENTE_PADRAO: Ambiente = 'dev';
export const NIVEL_LOG_PADRAO: NivelLog = 'info';
export const PORTA_PADRAO = 3000;
export const PORTA_MINIMA = 1;
export const PORTA_MAXIMA = 65535;

/** Origem liberada por padrão em desenvolvimento: o servidor local do Vite (frontend). */
export const ORIGENS_CORS_PADRAO_DEV: readonly string[] = ['http://localhost:5173'];

const SEPARADOR_DE_LISTA = ',';
const PADRAO_INTEIRO_POSITIVO = /^\d+$/;
const PROTOCOLOS_DE_ORIGEM: readonly string[] = ['http:', 'https:'];

/** Variáveis de ambiente que o backend conhece. Cada entrega acrescenta as suas aqui. */
export const NOMES_DAS_VARIAVEIS = ['ENV', 'PORT', 'LOG_LEVEL', 'CORS_ORIGENS'] as const;
export type NomeDaVariavel = (typeof NOMES_DAS_VARIAVEIS)[number];

/**
 * Trechos que denunciam um valor de exemplo (copiado do `.env.example` ou de um tutorial).
 * A comparação ignora maiúsculas e minúsculas.
 */
export const TRECHOS_DE_VALOR_DE_EXEMPLO: readonly string[] = [
  'localhost',
  '127.0.0.1',
  'exemplo',
  'example',
  'changeme',
  'change-me',
  'troque',
  'trocar',
  'placeholder',
  'seu-token',
  'sua-chave',
  '[senha]',
  'xxxx',
];

/**
 * Variáveis que, em produção, não podem ficar com valor de exemplo.
 * As próximas entregas acrescentam aqui PROXY_URL, PROXY_SERVICE_TOKEN, RESEND_API_KEY etc.
 */
export const VARIAVEIS_SEM_VALOR_DE_EXEMPLO_EM_PRODUCAO: readonly NomeDaVariavel[] = [
  'CORS_ORIGENS',
];

/** O que cada variável aceita. Vai para a mensagem de erro no lugar do valor recebido. */
const FORMATO_ESPERADO: Readonly<Record<NomeDaVariavel, string>> = {
  ENV: `deve ser ${AMBIENTES.join(', ')}`,
  PORT: `deve ser um inteiro entre ${PORTA_MINIMA} e ${PORTA_MAXIMA}`,
  LOG_LEVEL: `deve ser ${NIVEIS_LOG.join(', ')}`,
  CORS_ORIGENS:
    'deve ser uma lista de origens http(s) separadas por vírgula, sem caminho nem barra final',
};
const MOTIVO_OBRIGATORIA_FORA_DE_DEV = 'é obrigatória fora do ambiente dev';
const MOTIVO_VALOR_DE_EXEMPLO = 'não pode ficar com valor de exemplo em produção';

/** Configuração do backend, já validada e imutável. */
export interface Config {
  readonly ambiente: Ambiente;
  readonly porta: number;
  readonly nivelLog: NivelLog;
  /** Origens autorizadas a chamar a API pelo navegador (CORS). */
  readonly corsOrigens: readonly string[];
}

/** Uma variável de ambiente recusada e o motivo, sem o valor recebido. */
export interface ProblemaDeConfiguracao {
  readonly variavel: NomeDaVariavel;
  readonly motivo: string;
}

/**
 * Erro lançado na subida quando alguma variável de ambiente é inválida.
 * A mensagem cita só os nomes das variáveis e o formato esperado, nunca os valores recebidos,
 * porque ela vai para o log e os valores podem ser segredos.
 */
export class ConfigInvalidaError extends Error {
  constructor(public readonly problemas: readonly ProblemaDeConfiguracao[]) {
    const lista = problemas.map(({ variavel, motivo }) => `${variavel} (${motivo})`).join('; ');
    super(`Configuração inválida: ${lista}.`);
    this.name = 'ConfigInvalidaError';
  }

  /** Nomes das variáveis recusadas. */
  get variaveis(): readonly NomeDaVariavel[] {
    return this.problemas.map((problema) => problema.variavel);
  }
}

type VariaveisBrutas = Partial<Record<NomeDaVariavel, string>>;

const esquemaDasVariaveis = z.object({
  ENV: z.enum(AMBIENTES).optional(),
  PORT: z
    .string()
    .regex(PADRAO_INTEIRO_POSITIVO)
    .transform(Number)
    .pipe(z.number().int().min(PORTA_MINIMA).max(PORTA_MAXIMA))
    .optional(),
  LOG_LEVEL: z.enum(NIVEIS_LOG).optional(),
  CORS_ORIGENS: z
    .string()
    .transform(separarLista)
    .pipe(z.array(z.string().refine(ehOrigemValida)).min(1))
    .optional(),
});

function separarLista(texto: string): string[] {
  return texto
    .split(SEPARADOR_DE_LISTA)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Origem é só esquema + host + porta: é assim que o navegador a envia no cabeçalho Origin. */
function ehOrigemValida(texto: string): boolean {
  try {
    const url = new URL(texto);
    return PROTOCOLOS_DE_ORIGEM.includes(url.protocol) && url.origin === texto;
  } catch {
    return false;
  }
}

/** Indica se o valor parece ter sido copiado de um exemplo. */
export function ehValorDeExemplo(valor: string): boolean {
  const normalizado = valor.toLowerCase();
  return TRECHOS_DE_VALOR_DE_EXEMPLO.some((trecho) => normalizado.includes(trecho));
}

/** Lê só as variáveis conhecidas; variável vazia ou só com espaços conta como ausente. */
function lerVariaveis(env: NodeJS.ProcessEnv): VariaveisBrutas {
  const brutas: VariaveisBrutas = {};
  for (const nome of NOMES_DAS_VARIAVEIS) {
    const valor = env[nome]?.trim();
    if (valor) {
      brutas[nome] = valor;
    }
  }
  return brutas;
}

function ehNomeDaVariavel(valor: unknown): valor is NomeDaVariavel {
  return (NOMES_DAS_VARIAVEIS as readonly unknown[]).includes(valor);
}

/** Regras que dependem do ambiente. Só valem quando ENV é válida (ou ausente, que é dev). */
function validarRegrasDoAmbiente(
  brutas: VariaveisBrutas,
  problemas: Map<NomeDaVariavel, string>,
): void {
  const ambiente = z.enum(AMBIENTES).default(AMBIENTE_PADRAO).safeParse(brutas.ENV);
  if (!ambiente.success) {
    return;
  }
  if (ambiente.data !== 'dev' && brutas.CORS_ORIGENS === undefined) {
    problemas.set('CORS_ORIGENS', MOTIVO_OBRIGATORIA_FORA_DE_DEV);
  }
  if (ambiente.data !== 'producao') {
    return;
  }
  for (const nome of VARIAVEIS_SEM_VALOR_DE_EXEMPLO_EM_PRODUCAO) {
    const valor = brutas[nome];
    if (valor !== undefined && ehValorDeExemplo(valor) && !problemas.has(nome)) {
      problemas.set(nome, MOTIVO_VALOR_DE_EXEMPLO);
    }
  }
}

/**
 * Lê e valida as variáveis de ambiente do backend.
 *
 * @param env Fonte das variáveis; por padrão, `process.env`.
 * @returns A configuração validada e imutável.
 * @throws {ConfigInvalidaError} Se alguma variável for inválida. Todas as variáveis recusadas
 * são listadas de uma vez, para o responsável pelo deploy corrigir tudo em uma passada.
 */
export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const brutas = lerVariaveis(env);
  const resultado = esquemaDasVariaveis.safeParse(brutas);
  const problemas = new Map<NomeDaVariavel, string>();

  if (!resultado.success) {
    for (const { path } of resultado.error.issues) {
      const nome = path[0];
      if (ehNomeDaVariavel(nome)) {
        problemas.set(nome, FORMATO_ESPERADO[nome]);
      }
    }
  }
  validarRegrasDoAmbiente(brutas, problemas);

  if (!resultado.success || problemas.size > 0) {
    throw new ConfigInvalidaError(
      NOMES_DAS_VARIAVEIS.filter((nome) => problemas.has(nome)).map((variavel) => ({
        variavel,
        motivo: problemas.get(variavel) ?? FORMATO_ESPERADO[variavel],
      })),
    );
  }

  const { ENV, PORT, LOG_LEVEL, CORS_ORIGENS } = resultado.data;
  return Object.freeze({
    ambiente: ENV ?? AMBIENTE_PADRAO,
    porta: PORT ?? PORTA_PADRAO,
    nivelLog: LOG_LEVEL ?? NIVEL_LOG_PADRAO,
    corsOrigens: Object.freeze(CORS_ORIGENS ?? [...ORIGENS_CORS_PADRAO_DEV]),
  });
}
