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
  /** Falhas transitórias do servidor (5xx, 408, 429) já contadas; rede fora do ar não conta. */
  tentativas?: number;
  /** Só tentar de novo depois deste instante (espera crescente após falha do servidor). */
  proximaEm?: number;
  /** Esgotou as tentativas: a fila para neste item até o usuário tentar de novo ou descartar. */
  falhou?: boolean;
  /** Mensagem da última falha do servidor, para o aviso. */
  ultimoErro?: string;
}

/** Tentativas com falha do servidor antes de marcar a alteração como falha. */
export const MAX_TENTATIVAS = 5;
const ESPERA_BASE_MS = 30_000;
const ESPERA_MAX_MS = 10 * 60_000;
/** Nenhuma chamada da fila pode segurar a fila para sempre (rede pendurada). */
export const LIMITE_CHAMADA_MS = 30_000;

/** Espera antes da próxima tentativa: 30 s, 1 min, 2 min, 4 min... até 10 min. */
export function esperaDaTentativa(tentativas: number): number {
  return Math.min(ESPERA_BASE_MS * 2 ** Math.max(0, tentativas - 1), ESPERA_MAX_MS);
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
let novaRodada = false;
let rodadaSemEspera = false;
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

/** Rejeita se a promessa não terminar no prazo; a original segue solta, sem segurar a fila. */
function comLimite<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo esgotado')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Falha do servidor (não da rede): conta para o limite de tentativas. */
function falhaDoServidor(e: ApiError): boolean {
  return (
    e.status >= 500 ||
    e.status === 408 ||
    e.status === 429 ||
    e.codigo === 'REQUISICAO_EM_ANDAMENTO'
  );
}

/** Usuário desiste da alteração parada (ou de qualquer uma da fila). */
export function descartarItem(chave: string): void {
  const i = carregar().findIndex((x) => x.chave === chave);
  if (i < 0) return;
  carregar().splice(i, 1);
  gravar();
  void processarFila({ ignorarEspera: true });
}

/** Zera as tentativas do item parado e reenvia já. */
export function tentarNovamente(chave: string): void {
  const item = carregar().find((x) => x.chave === chave);
  if (!item) return;
  item.falhou = false;
  item.tentativas = 0;
  item.proximaEm = undefined;
  gravar();
  void processarFila({ ignorarEspera: true });
}

/** Primeira alteração parada por falha definitiva do servidor (a que bloqueia a fila). */
export function itemComFalha(): ItemFila | undefined {
  const primeiro = carregar()[0];
  return primeiro?.falhou ? primeiro : undefined;
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

export interface OpcoesProcessamento {
  /** Evento `online` ou ação do usuário: ignora a espera crescente (não o limite de tentativas). */
  ignorarEspera?: boolean;
}

/**
 * Reenvia em ordem. Para no primeiro item que ainda não pode seguir (sem rede, 5xx, espera,
 * falha definitiva). Nunca perde dados: só 4xx definitivo descarta (com aviso).
 */
export function processarFila(opcoes: OpcoesProcessamento = {}): Promise<void> {
  if (processando) {
    // Já há uma rodada em andamento (talvez com a rede de antes): pede mais uma ao terminar,
    // para um evento `online` ou o timer nunca ficarem sem efeito.
    novaRodada = true;
    if (opcoes.ignorarEspera) rodadaSemEspera = true;
    return processando;
  }
  processando = (async () => {
    try {
      do {
        novaRodada = false;
        await rodada(opcoes.ignorarEspera || rodadaSemEspera);
        rodadaSemEspera = false;
      } while (novaRodada);
    } finally {
      processando = null;
    }
  })();
  return processando;
}

async function rodada(ignorarEspera: boolean | undefined): Promise<void> {
  while (ganchos && ganchos.autenticado()) {
    const item = carregar()[0];
    if (!item || item.falhou) return;
    if (!ignorarEspera && item.proximaEm && item.proximaEm > Date.now()) return;
    if (!item.enviado) {
      try {
        await comLimite(ganchos.enviar(item), LIMITE_CHAMADA_MS);
      } catch (e) {
        if (!(e instanceof ApiError)) return; // rede, tempo esgotado ou aborto: tenta depois
        if (transitorio(e)) {
          if (falhaDoServidor(e)) {
            item.tentativas = (item.tentativas ?? 0) + 1;
            item.ultimoErro = e.message;
            if (item.tentativas >= MAX_TENTATIVAS) {
              item.falhou = true;
              item.proximaEm = undefined;
            } else item.proximaEm = Date.now() + esperaDaTentativa(item.tentativas);
            gravar();
          }
          return;
        }
        carregar().shift(); // 4xx definitivo: repetir não adianta
        gravar();
        ganchos.descartado(item, e);
        continue;
      }
      item.enviado = true;
      item.tentativas = 0;
      item.proximaEm = undefined;
      gravar();
    }
    try {
      await comLimite(Promise.resolve(ganchos.reler(item)), LIMITE_CHAMADA_MS);
    } catch {
      return; // releitura travada ou falhou: o item fica (já enviado) e a releitura repete
    }
    const i = carregar().indexOf(item);
    if (i >= 0) carregar().splice(i, 1);
    gravar();
  }
}
