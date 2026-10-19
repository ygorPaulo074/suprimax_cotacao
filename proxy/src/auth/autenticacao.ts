import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../erros';
import type { Integrante, RepositorioIntegrantes } from './integrantes';
import { hashToken, verificarToken, type ClaimsIntegrante } from './token';

// Cabeçalhos obrigatórios em toda requisição (docs/12, seção 12.3):
//   Authorization: Bearer <token do integrante>   X-Timestamp   X-Service-Id   X-Operation-Id

export type Cabecalhos = Record<string, string | string[] | undefined>;

export interface ContextoAutenticado {
  serviceId: string;
  operationId: string;
  escopos: string[];
  integrante: Integrante | null; // null na administração (chave mestra)
  admin: boolean;
}

/**
 * Impede repetir a mesma requisição dentro da janela de tolerância: a chave é a combinação
 * integrante + timestamp + conteúdo. Um reenvio legítimo deve gerar novo X-Timestamp.
 */
export class CacheReplay {
  private readonly vistos = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maximo = 10_000,
  ) {}

  /** true se é a primeira vez; false se já foi visto (replay). */
  registrar(chave: string, agora: number): boolean {
    this.limpar(agora);
    if (this.vistos.has(chave)) return false;
    this.vistos.set(chave, agora + this.ttlMs);
    return true;
  }

  private limpar(agora: number): void {
    for (const [chave, expira] of this.vistos) {
      if (expira <= agora || this.vistos.size > this.maximo) this.vistos.delete(chave);
      else break; // inseridos em ordem: o resto ainda vale
    }
  }
}

export interface DepsAutenticacao {
  segredoJwt: string;
  chaveAdmin: string;
  toleranciaSegundos: number;
  integrantes: RepositorioIntegrantes;
  replay: CacheReplay;
  agora: () => Date;
}

function cabecalho(h: Cabecalhos, nome: string): string | undefined {
  const v = h[nome];
  const valor = Array.isArray(v) ? v[0] : v;
  return valor?.trim() ? valor.trim() : undefined;
}

function extrairBearer(h: Cabecalhos): string {
  const auth = cabecalho(h, 'authorization');
  const m = auth?.match(/^Bearer\s+(\S+)$/i);
  if (!m?.[1]) throw new AppError('TOKEN_INVALIDO', undefined, 'Authorization ausente');
  return m[1];
}

/** Aceita ISO 8601 ou milissegundos desde a época. */
export function lerTimestamp(valor: string): number | null {
  const ms = /^\d{10,}$/.test(valor) ? Number(valor) : Date.parse(valor);
  return Number.isFinite(ms) ? ms : null;
}

function conferirTimestamp(h: Cabecalhos, deps: DepsAutenticacao): string {
  const bruto = cabecalho(h, 'x-timestamp');
  if (!bruto) throw new AppError('TOKEN_INVALIDO', undefined, 'X-Timestamp ausente');
  const ts = lerTimestamp(bruto);
  if (ts === null) throw new AppError('TOKEN_INVALIDO', undefined, 'X-Timestamp ilegível');
  if (Math.abs(deps.agora().getTime() - ts) > deps.toleranciaSegundos * 1000) {
    throw new AppError('TOKEN_INVALIDO', undefined, 'X-Timestamp fora da tolerância');
  }
  return bruto;
}

function conferirReplay(
  deps: DepsAutenticacao,
  serviceId: string,
  timestamp: string,
  corpo: string,
): void {
  const chave = createHash('sha256').update(`${serviceId}|${timestamp}|${corpo}`).digest('hex');
  if (!deps.replay.registrar(chave, deps.agora().getTime())) {
    throw new AppError('TOKEN_INVALIDO', undefined, 'requisição repetida');
  }
}

function operationId(h: Cabecalhos): string {
  const id = cabecalho(h, 'x-operation-id');
  if (!id) throw new AppError('PAYLOAD_INVALIDO', undefined, 'X-Operation-Id ausente');
  return id;
}

function iguais(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Integrante comum: token JWT + integrante ativo, não expirado e com o mesmo hash de token. */
export async function autenticarIntegrante(
  deps: DepsAutenticacao,
  headers: Cabecalhos,
  corpoBruto: string,
): Promise<ContextoAutenticado> {
  const token = extrairBearer(headers);
  const timestamp = conferirTimestamp(headers, deps);
  const serviceId = cabecalho(headers, 'x-service-id');
  if (!serviceId) throw new AppError('TOKEN_INVALIDO', undefined, 'X-Service-Id ausente');

  const claims: ClaimsIntegrante = verificarToken(deps.segredoJwt, token);
  if (claims.service_id !== serviceId) {
    throw new AppError('TOKEN_INVALIDO', undefined, 'X-Service-Id diferente do token');
  }

  const integrante = await deps.integrantes.buscarPorId(claims.service_id);
  const agora = deps.agora();
  if (
    !integrante ||
    !integrante.ativo ||
    (integrante.expiraEm && integrante.expiraEm <= agora) ||
    !iguais(integrante.chaveHash, hashToken(token))
  ) {
    throw new AppError(
      'TOKEN_INVALIDO',
      undefined,
      'integrante inexistente, revogado ou token substituído',
    );
  }

  conferirReplay(deps, serviceId, timestamp, corpoBruto);
  return {
    serviceId,
    operationId: operationId(headers),
    // Os escopos valem os do cadastro (revogáveis sem redeploy), não os do token.
    escopos: integrante.escopos,
    integrante,
    admin: false,
  };
}

/** Administração de integrantes: só com a chave mestra (PROXY_ADMIN_KEY), no lugar do token. */
export function autenticarAdmin(
  deps: DepsAutenticacao,
  headers: Cabecalhos,
  corpoBruto: string,
): ContextoAutenticado {
  const chave = extrairBearer(headers);
  if (!iguais(chave, deps.chaveAdmin)) {
    throw new AppError('TOKEN_INVALIDO', undefined, 'chave mestra inválida');
  }
  const timestamp = conferirTimestamp(headers, deps);
  const serviceId = cabecalho(headers, 'x-service-id') ?? 'admin';
  conferirReplay(deps, serviceId, timestamp, corpoBruto);
  return {
    serviceId,
    operationId: operationId(headers),
    escopos: [],
    integrante: null,
    admin: true,
  };
}
