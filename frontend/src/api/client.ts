import { API_URL } from '../config';
import { ApiError } from './errors';
import { configurarFila, enfileirar, processarFila, quantidadePendente } from './filaOffline';
import type { ErroApi } from './types';

export { ApiError };

let token: string | null = null;
let aoNaoAutorizado: (() => void) | null = null;

export function definirToken(novo: string | null): void {
  token = novo;
}
export function obterToken(): string | null {
  return token;
}
/** O AuthProvider registra aqui o que fazer num 401 (limpar sessão e ir ao login). */
export function aoReceberNaoAutorizado(fn: (() => void) | null): void {
  aoNaoAutorizado = fn;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface OpcoesRequisicao {
  query?: Query;
  body?: unknown;
  /** FormData para upload (anexos, documentos); não define Content-Type. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Idempotency-Key já definida (reenvio da fila). Sem ela, mutações de /orcamentos geram uma. */
  chave?: string;
  /** Reenvio da fila: não enfileira de novo. */
  semFila?: boolean;
}

const MUTACAO = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const ROTA_ORCAMENTO = /^\/orcamentos(\/|$)/;
/** Rotas de orçamento com mutação JSON (o upload de anexo não aceita a chave). */
function mutacaoDeOrcamento(metodo: string, caminho: string, opcoes: OpcoesRequisicao): boolean {
  return MUTACAO.has(metodo) && ROTA_ORCAMENTO.test(caminho) && !opcoes.formData;
}
/** Só quem já tem um orçamento (id na rota) pode esperar na fila: criar precisa da resposta. */
function enfileiravel(caminho: string): boolean {
  return /^\/orcamentos\/\d+(\/|$)/.test(caminho);
}

function novaChave(): string {
  return globalThis.crypto.randomUUID();
}

export function montarUrl(caminho: string, query?: Query): string {
  const url = new URL(`${API_URL.replace(/\/$/, '')}${caminho}`);
  for (const [chave, valor] of Object.entries(query ?? {})) {
    if (valor !== undefined && valor !== null && valor !== '')
      url.searchParams.set(chave, String(valor));
  }
  return url.toString();
}

async function requisitar(
  metodo: string,
  caminho: string,
  opcoes: OpcoesRequisicao = {},
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opcoes.formData) body = opcoes.formData;
  else if (opcoes.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opcoes.body);
  }

  const comChave = mutacaoDeOrcamento(metodo, caminho, opcoes);
  const chave = comChave ? (opcoes.chave ?? novaChave()) : undefined;
  if (chave) headers['Idempotency-Key'] = chave;
  const guardavel = comChave && !opcoes.semFila && enfileiravel(caminho);
  const guardar = (): never => {
    enfileirar({ chave: chave!, metodo, caminho, body: opcoes.body, criadoEm: Date.now() });
    void processarFila();
    throw new ApiError(
      0,
      'ENFILEIRADA',
      'Sem conexão. A alteração foi guardada neste aparelho e será enviada quando a conexão voltar.',
    );
  };
  // Já há alterações esperando: esta entra atrás delas para manter a ordem.
  if (guardavel && quantidadePendente() > 0) guardar();

  let resposta: Response;
  try {
    resposta = await fetch(montarUrl(caminho, opcoes.query), {
      method: metodo,
      headers,
      body,
      signal: opcoes.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    if (guardavel) guardar();
    throw new ApiError(0, 'SEM_CONEXAO', 'Sem conexão com o servidor. Tente novamente.');
  }

  if (!resposta.ok) {
    const erro = (await resposta.json().catch(() => null)) as Partial<ErroApi> | null;
    if (resposta.status === 401 && caminho !== '/auth/login') aoNaoAutorizado?.();
    throw new ApiError(
      resposta.status,
      erro?.codigo ?? `HTTP_${resposta.status}`,
      erro?.mensagem ?? 'Não foi possível concluir a operação.',
      erro?.detalhes,
    );
  }
  return resposta;
}

async function json<T>(metodo: string, caminho: string, opcoes?: OpcoesRequisicao): Promise<T> {
  const resposta = await requisitar(metodo, caminho, opcoes);
  if (resposta.status === 204) return undefined as T;
  return (await resposta.json()) as T;
}

export const api = {
  get: <T>(caminho: string, opcoes?: OpcoesRequisicao) => json<T>('GET', caminho, opcoes),
  post: <T>(caminho: string, body?: unknown, opcoes?: OpcoesRequisicao) =>
    json<T>('POST', caminho, { ...opcoes, body }),
  put: <T>(caminho: string, body?: unknown, opcoes?: OpcoesRequisicao) =>
    json<T>('PUT', caminho, { ...opcoes, body }),
  patch: <T>(caminho: string, body?: unknown, opcoes?: OpcoesRequisicao) =>
    json<T>('PATCH', caminho, { ...opcoes, body }),
  delete: <T>(caminho: string, opcoes?: OpcoesRequisicao) => json<T>('DELETE', caminho, opcoes),
  upload: <T>(caminho: string, formData: FormData) => json<T>('POST', caminho, { formData }),
  /** Baixa um arquivo (PDF do orçamento). */
  baixar: async (caminho: string): Promise<Blob> => (await requisitar('GET', caminho)).blob(),
};

/** Reenvio da fila: mesma chave, sem enfileirar de novo. */
configurarFila({
  enviar: (item) =>
    json(item.metodo, item.caminho, { body: item.body, chave: item.chave, semFila: true }),
  reler: () => undefined, // o AppShell troca por quem invalida o TanStack Query
  descartado: () => undefined,
  autenticado: () => token !== null,
});
