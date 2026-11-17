/**
 * Fila persistida de mutações de orçamento feitas sem conexão (RNF06).
 * Guarda só o necessário para reenviar (método, rota, corpo JSON e Idempotency-Key); nunca o token.
 */
import { ApiError } from './errors';

const CHAVE = 'suprimax.fila';

export interface ItemFila {
  /** Idempotency-Key: gerada uma vez por ação do usuário e reutilizada em todo reenvio. */
  chave: string;
  metodo: string;
  caminho: string;
  body?: unknown;
  criadoEm: number;
  /** Já aceito pelo backend; falta só a releitura dos dados antes de sair da fila. */
  enviado?: boolean;
}

export interface GanchosFila {
  /** Reenvia a requisição com a MESMA chave. Lança ApiError em falha. */
  enviar: (item: ItemFila) => Promise<unknown>;
  /** Relê os dados afetados (invalidação do TanStack Query). A fila só descarta o item depois dela. */
  reler: (item: ItemFila) => Promise<unknown> | void;
  /** Item removido por erro 4xx definitivo: avisar o usuário. */
  descartado: (item: ItemFila, erro: ApiError) => void;
  /** Há token de sessão? Sem ele, nada é reenviado. */
  autenticado: () => boolean;
}

let itens: ItemFila[] | null = null;
let ganchos: GanchosFila | null = null;
let processando: Promise<void> | null = null;
const ouvintes = new Set<() => void>();
let versao = 0;

function armazenamento(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function carregar(): ItemFila[] {
  if (itens) return itens;
  try {
    const bruto = armazenamento()?.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : [];
    itens = Array.isArray(lido)
      ? (lido as ItemFila[]).filter((i) => i && i.chave && i.caminho)
      : [];
  } catch {
    itens = [];
  }
  return itens;
}

function gravar(): void {
  versao += 1;
  try {
    const a = armazenamento();
    if (!a) return;
    if (carregar().length === 0) a.removeItem(CHAVE);
    else a.setItem(CHAVE, JSON.stringify(carregar()));
  } catch {
    /* sem armazenamento: a fila vale só até recarregar */
  }
  ouvintes.forEach((o) => o());
}

/** Mescla ganchos parciais (o cliente HTTP dá `enviar`; o AppShell dá `reler` e `descartado`). */
export function configurarFila(g: Partial<GanchosFila>): void {
  ganchos = { ...(ganchos ?? PADRAO), ...g };
}
const PADRAO: GanchosFila = {
  enviar: () => Promise.reject(new Error('fila sem cliente HTTP')),
  reler: () => undefined,
  descartado: () => undefined,
  autenticado: () => false,
};

/** Usado pelo indicador de pendências (useSyncExternalStore). */
export function assinarFila(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
export function versaoDaFila(): number {
  return versao;
}
export function quantidadePendente(): number {
  return carregar().length;
}
export function itensPendentes(): readonly ItemFila[] {
  return carregar();
}

export function enfileirar(item: ItemFila): void {
  carregar().push(item);
  gravar();
}

/** Logout: descarta tudo e esquece o armazenamento. */
export function limparFila(): void {
  itens = [];
  gravar();
}

/** Só recarrega do armazenamento (testes e troca de aba). */
export function reiniciarFilaEmMemoria(): void {
  itens = null;
  processando = null;
  versao += 1;
}

function transitorio(e: ApiError): boolean {
  return (
    e.status === 0 ||
    e.status >= 500 ||
    e.status === 408 ||
    e.status === 429 ||
    e.status === 401 ||
    e.codigo === 'REQUISICAO_EM_ANDAMENTO'
  );
}

/** Reenvia em ordem. Para no primeiro item que ainda não pode seguir (sem rede, 5xx). */
export function processarFila(): Promise<void> {
  if (processando) return processando;
  processando = (async () => {
    try {
      while (ganchos && ganchos.autenticado()) {
        const item = carregar()[0];
        if (!item) return;
        if (!item.enviado) {
          try {
            await ganchos.enviar(item);
          } catch (e) {
            if (!(e instanceof ApiError) || transitorio(e)) return;
            carregar().shift(); // 4xx definitivo: repetir não adianta
            gravar();
            ganchos.descartado(item, e);
            continue;
          }
          item.enviado = true;
          gravar();
        }
        await ganchos.reler(item);
        const i = carregar().indexOf(item);
        if (i >= 0) carregar().splice(i, 1);
        gravar();
      }
    } finally {
      processando = null;
    }
  })();
  return processando;
}
