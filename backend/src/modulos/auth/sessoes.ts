// UC13 — sessão do usuário: token gerado no login, expiração por inatividade (RN02).
import { createHash, randomBytes } from 'node:crypto';

/** Perfis de usuário (docs/13, seção 13.4, "Perfis de usuário"). */
export const PERFIS = [
  'VENDEDOR',
  'OPERADOR',
  'OPERADOR_CHEFE',
  'FISCAL',
  'FINANCEIRO',
  'GESTOR',
] as const;
export type Perfil = (typeof PERFIS)[number];

/** Dados do usuário autenticado. É o tipo `Sessao` de `frontend/src/api/types.ts`. */
export interface Sessao {
  readonly idOperador: number;
  readonly usuario: string;
  /** A tabela `operador` não tem coluna de nome: repete `usuario`. */
  readonly nome: string;
  readonly email: string;
  readonly perfil: Perfil;
}

/**
 * Guarda as sessões abertas. Os módulos dependem desta interface; a implementação atual fica em
 * memória e pode ser trocada por uma tabela do banco sem mudar quem a usa.
 */
export interface RepositorioDeSessoes {
  /** Abre uma sessão e devolve o token, que só existe em texto puro nesta resposta. */
  criar(sessao: Sessao): Promise<string>;
  /** Devolve a sessão do token e renova seu prazo; `null` se não existir ou tiver expirado. */
  buscar(token: string): Promise<Sessao | null>;
  /** Encerra a sessão do token (logout). Token desconhecido é ignorado. */
  encerrar(token: string): Promise<void>;
  /** Encerra todas as sessões de um usuário (por exemplo, ao inativá-lo). */
  encerrarDoOperador(idOperador: number): Promise<void>;
}

/** Bytes aleatórios do token (256 bits). */
export const BYTES_DO_TOKEN_DE_SESSAO = 32;
/** De quanto em quanto tempo as sessões expiradas são removidas da memória. */
export const INTERVALO_DE_LIMPEZA_PADRAO_MS = 60_000;

const ALGORITMO_DO_RESUMO = 'sha256';

export interface OpcoesDoRepositorioDeSessoesEmMemoria {
  /** Tempo sem uso até a sessão expirar. */
  readonly inatividadeMs: number;
  /** Relógio; por padrão, a hora do sistema. Os testes passam um relógio controlado. */
  readonly agora?: () => Date;
  readonly intervaloDeLimpezaMs?: number;
}

interface SessaoGuardada {
  readonly sessao: Sessao;
  expiraEm: number;
}

/**
 * Sessões na memória do processo. Quando o serviço reinicia (deploy ou hibernação do Render),
 * todas as sessões se perdem e os usuários entram de novo.
 *
 * A memória guarda só o SHA-256 de cada token: quem conseguir ler a memória ou um despejo dela
 * não obtém tokens utilizáveis.
 */
export class RepositorioDeSessoesEmMemoria implements RepositorioDeSessoes {
  private readonly sessoes = new Map<string, SessaoGuardada>();
  private readonly inatividadeMs: number;
  private readonly agora: () => Date;
  private readonly intervaloDeLimpezaMs: number;
  private temporizador?: NodeJS.Timeout;

  constructor(opcoes: OpcoesDoRepositorioDeSessoesEmMemoria) {
    this.inatividadeMs = opcoes.inatividadeMs;
    this.agora = opcoes.agora ?? (() => new Date());
    this.intervaloDeLimpezaMs = opcoes.intervaloDeLimpezaMs ?? INTERVALO_DE_LIMPEZA_PADRAO_MS;
  }

  /** Quantidade de sessões guardadas, incluindo as expiradas ainda não removidas. */
  get quantidade(): number {
    return this.sessoes.size;
  }

  async criar(sessao: Sessao): Promise<string> {
    const token = randomBytes(BYTES_DO_TOKEN_DE_SESSAO).toString('base64url');
    this.sessoes.set(this.resumir(token), { sessao, expiraEm: this.novoPrazo() });
    return token;
  }

  async buscar(token: string): Promise<Sessao | null> {
    const chave = this.resumir(token);
    const guardada = this.sessoes.get(chave);
    if (!guardada) {
      return null;
    }
    if (guardada.expiraEm <= this.agora().getTime()) {
      this.sessoes.delete(chave);
      return null;
    }
    guardada.expiraEm = this.novoPrazo();
    return guardada.sessao;
  }

  async encerrar(token: string): Promise<void> {
    this.sessoes.delete(this.resumir(token));
  }

  async encerrarDoOperador(idOperador: number): Promise<void> {
    for (const [chave, { sessao }] of this.sessoes) {
      if (sessao.idOperador === idOperador) {
        this.sessoes.delete(chave);
      }
    }
  }

  /** Remove as sessões expiradas. Devolve quantas foram removidas. */
  removerExpiradas(): number {
    const agora = this.agora().getTime();
    let removidas = 0;
    for (const [chave, { expiraEm }] of this.sessoes) {
      if (expiraEm <= agora) {
        this.sessoes.delete(chave);
        removidas += 1;
      }
    }
    return removidas;
  }

  /** Liga a limpeza periódica. O temporizador não impede o processo de encerrar. */
  iniciarLimpeza(): void {
    if (this.temporizador) {
      return;
    }
    this.temporizador = setInterval(() => this.removerExpiradas(), this.intervaloDeLimpezaMs);
    this.temporizador.unref();
  }

  /** Desliga a limpeza periódica. */
  pararLimpeza(): void {
    clearInterval(this.temporizador);
    this.temporizador = undefined;
  }

  private novoPrazo(): number {
    return this.agora().getTime() + this.inatividadeMs;
  }

  private resumir(token: string): string {
    return createHash(ALGORITMO_DO_RESUMO).update(token).digest('hex');
  }
}
