// UC13 — sessão do usuário: token gerado no login, expiração por inatividade (RN02).
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ClienteDeProxy } from '../../dados';

/** Perfis de usuário (docs/13, seção 13.4, "Perfis de usuário"). */
export const PERFIS = [
  'VENDEDOR',
  'OPERADOR',
  'OPERADOR_CHEFE',
  'FISCAL',
  'FINANCEIRO',
  'GESTOR',
  'ADMIN',
] as const;
export type Perfil = (typeof PERFIS)[number];

/** Perfil com acesso a todas as rotas; só um ADMIN gerencia usuários ADMIN. */
export const PERFIL_ADMIN: Perfil = 'ADMIN';

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
 * Guarda as sessões abertas. Os módulos dependem desta interface. Com SESSOES_NO_BANCO=true, a
 * implementação é a tabela `sessao` do banco, pelo proxy (`RepositorioDeSessoesNoProxy`); senão
 * (e nos testes), a memória do processo (`RepositorioDeSessoesEmMemoria`).
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
  /**
   * Apaga as sessões vencidas guardadas fora do processo e devolve quantas. Só existe quando a
   * limpeza depende dos jobs (`POST /jobs/executar`); a memória tem o próprio temporizador.
   */
  limparExpiradas?(): Promise<number>;
}

/** Bytes aleatórios do token (256 bits). */
export const BYTES_DO_TOKEN_DE_SESSAO = 32;
/** De quanto em quanto tempo as sessões expiradas são removidas da memória. */
export const INTERVALO_DE_LIMPEZA_PADRAO_MS = 60_000;

const ALGORITMO_DO_RESUMO = 'sha256';

/** SHA-256 do token, em hexadecimal: é só isso que a memória ou o banco guardam. */
export function resumirTokenDeSessao(token: string): string {
  return createHash(ALGORITMO_DO_RESUMO).update(token).digest('hex');
}

function novoTokenDeSessao(): string {
  return randomBytes(BYTES_DO_TOKEN_DE_SESSAO).toString('base64url');
}

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
    const token = novoTokenDeSessao();
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
    return resumirTokenDeSessao(token);
  }
}

// ---- Sessões no banco, pelo proxy ----------------------------------------------------------

/** Operações do proxy sobre a tabela `sessao` (proxy/src/operacoes/sessoes.ts). */
export const OPERACOES_DE_SESSAO_NO_PROXY = {
  CRIAR: 'sessao.criar',
  BUSCAR: 'sessao.buscar',
  ENCERRAR: 'sessao.encerrar',
  ENCERRAR_DO_OPERADOR: 'sessao.encerrar_operador',
  REMOVER_EXPIRADAS: 'sessao.remover_expiradas',
} as const;

/** Identificadores das chamadas na auditoria do proxy. */
export const IDS_DAS_CHAMADAS_DE_SESSAO = {
  CRIAR: 'UC13-sessao-criar',
  BUSCAR: 'UC13-sessao-buscar',
  ENCERRAR: 'UC13-sessao-encerrar',
  ENCERRAR_DO_OPERADOR: 'UC13-sessao-encerrar-do-operador',
  REMOVER_EXPIRADAS: 'UC13-sessao-remover-expiradas',
} as const;

/** Por quanto tempo uma sessão lida do banco vale sem nova consulta ao proxy. */
export const CACHE_DE_SESSAO_PADRAO_MS = 5_000;
/** Intervalo mínimo entre duas renovações do prazo da mesma sessão no banco. */
export const INTERVALO_DE_RENOVACAO_PADRAO_MS = 60_000;

const STATUS_ATIVO = 'ATIVO';
const MS_POR_SEGUNDO = 1000;

const esquemaDaSessaoDoBanco = z.object({
  idOperador: z.number().int(),
  usuario: z.string(),
  email: z.string(),
  perfil: z.string(),
  status: z.string(),
});
type SessaoDoBanco = z.infer<typeof esquemaDaSessaoDoBanco>;

const esquemaDaRespostaDaBusca = z.object({ dados: esquemaDaSessaoDoBanco.nullable().optional() });
const esquemaDaRespostaDeExclusao = z.object({ afetados: z.number().int().optional() });

export interface OpcoesDoRepositorioDeSessoesNoProxy {
  readonly proxy: ClienteDeProxy;
  /** Tempo sem uso até a sessão expirar (o banco guarda e confere o prazo). */
  readonly inatividadeMs: number;
  /** Relógio do cache local; o prazo da sessão usa o relógio do banco. */
  readonly agora?: () => Date;
  readonly cacheMs?: number;
  readonly intervaloDeRenovacaoMs?: number;
}

interface SessaoEmCache {
  readonly sessao: Sessao;
  /** Até quando a sessão vale sem consultar o proxy. */
  readonly validaAte: number;
  /** Última vez que o prazo foi gravado no banco (criação ou renovação). */
  readonly renovadaEm: number;
}

/**
 * Sessões na tabela `sessao` do banco, pelo proxy (RNF05): sobrevivem a deploy e reinício do
 * backend (UC13, RN02). O banco guarda só o SHA-256 do token; o prazo é conferido com o relógio
 * do banco.
 *
 * Para não ir ao proxy a cada requisição:
 * - a sessão lida fica alguns segundos em memória (`cacheMs`);
 * - o prazo no banco é renovado no máximo uma vez por `intervaloDeRenovacaoMs` (limitado à metade
 *   da inatividade). Por isso a sessão pode vencer até esse intervalo antes do que venceria com
 *   renovação a cada uso.
 *
 * Logout, inativação, troca de perfil e senha redefinida passam por aqui e limpam o cache deste
 * processo na hora. A busca traz os dados atuais do operador: e-mail e perfil novos valem na
 * próxima consulta ao proxy, e operador que deixou de ser ATIVO perde a sessão.
 *
 * Falha do proxy não vira 401: o erro segue para o tratamento padrão (5xx), e o usuário não é
 * deslogado por uma indisponibilidade passageira.
 */
export class RepositorioDeSessoesNoProxy implements RepositorioDeSessoes {
  private readonly cache = new Map<string, SessaoEmCache>();
  private readonly proxy: ClienteDeProxy;
  private readonly validadeSegundos: number;
  private readonly agora: () => Date;
  private readonly cacheMs: number;
  private readonly intervaloDeRenovacaoMs: number;
  private ultimaFaxina = 0;

  constructor(opcoes: OpcoesDoRepositorioDeSessoesNoProxy) {
    this.proxy = opcoes.proxy;
    this.validadeSegundos = Math.round(opcoes.inatividadeMs / MS_POR_SEGUNDO);
    this.agora = opcoes.agora ?? (() => new Date());
    this.cacheMs = opcoes.cacheMs ?? CACHE_DE_SESSAO_PADRAO_MS;
    this.intervaloDeRenovacaoMs = Math.min(
      opcoes.intervaloDeRenovacaoMs ?? INTERVALO_DE_RENOVACAO_PADRAO_MS,
      Math.floor(opcoes.inatividadeMs / 2),
    );
  }

  /** Sessões no cache deste processo, inclusive as que já passaram do prazo do cache. */
  get quantidadeEmCache(): number {
    return this.cache.size;
  }

  async criar(sessao: Sessao): Promise<string> {
    const token = novoTokenDeSessao();
    const tokenHash = resumirTokenDeSessao(token);
    await this.proxy.executar(
      OPERACOES_DE_SESSAO_NO_PROXY.CRIAR,
      {
        token_hash: tokenHash,
        id_operador: sessao.idOperador,
        validade_segundos: this.validadeSegundos,
      },
      IDS_DAS_CHAMADAS_DE_SESSAO.CRIAR,
    );
    const agora = this.agora().getTime();
    this.cache.set(tokenHash, { sessao, validaAte: agora + this.cacheMs, renovadaEm: agora });
    return token;
  }

  async buscar(token: string): Promise<Sessao | null> {
    const tokenHash = resumirTokenDeSessao(token);
    const agora = this.agora().getTime();
    this.esquecerAntigas(agora);
    const emCache = this.cache.get(tokenHash);
    const renovar = !emCache || agora - emCache.renovadaEm >= this.intervaloDeRenovacaoMs;
    if (emCache && !renovar && agora < emCache.validaAte) {
      return emCache.sessao;
    }

    const resposta = esquemaDaRespostaDaBusca.parse(
      await this.proxy.executar(
        OPERACOES_DE_SESSAO_NO_PROXY.BUSCAR,
        { token_hash: tokenHash, ...(renovar && { renovar_segundos: this.validadeSegundos }) },
        IDS_DAS_CHAMADAS_DE_SESSAO.BUSCAR,
      ),
    );
    const sessao = paraSessao(resposta.dados ?? null);
    if (!sessao) {
      this.cache.delete(tokenHash);
      return null;
    }
    this.cache.set(tokenHash, {
      sessao,
      validaAte: agora + this.cacheMs,
      renovadaEm: renovar || !emCache ? agora : emCache.renovadaEm,
    });
    return sessao;
  }

  async encerrar(token: string): Promise<void> {
    const tokenHash = resumirTokenDeSessao(token);
    this.cache.delete(tokenHash);
    await this.proxy.executar(
      OPERACOES_DE_SESSAO_NO_PROXY.ENCERRAR,
      { token_hash: tokenHash },
      IDS_DAS_CHAMADAS_DE_SESSAO.ENCERRAR,
    );
  }

  async encerrarDoOperador(idOperador: number): Promise<void> {
    for (const [chave, { sessao }] of this.cache) {
      if (sessao.idOperador === idOperador) {
        this.cache.delete(chave);
      }
    }
    await this.proxy.executar(
      OPERACOES_DE_SESSAO_NO_PROXY.ENCERRAR_DO_OPERADOR,
      { id_operador: idOperador },
      IDS_DAS_CHAMADAS_DE_SESSAO.ENCERRAR_DO_OPERADOR,
    );
  }

  async limparExpiradas(): Promise<number> {
    this.esquecerAntigas(this.agora().getTime(), true);
    const resposta = esquemaDaRespostaDeExclusao.parse(
      await this.proxy.executar(
        OPERACOES_DE_SESSAO_NO_PROXY.REMOVER_EXPIRADAS,
        {},
        IDS_DAS_CHAMADAS_DE_SESSAO.REMOVER_EXPIRADAS,
      ),
    );
    return resposta.afetados ?? 0;
  }

  /**
   * Tira do cache as sessões sem renovação há mais que o prazo de inatividade (no banco elas já
   * venceram). Roda no máximo uma vez por intervalo de renovação, salvo com `forcar`.
   */
  private esquecerAntigas(agora: number, forcar = false): void {
    if (!forcar && agora - this.ultimaFaxina < this.intervaloDeRenovacaoMs) {
      return;
    }
    this.ultimaFaxina = agora;
    const limite = agora - this.validadeSegundos * MS_POR_SEGUNDO;
    for (const [chave, { renovadaEm }] of this.cache) {
      if (renovadaEm <= limite) {
        this.cache.delete(chave);
      }
    }
  }
}

/** Linha do banco para `Sessao`; operador fora de ATIVO ou com perfil desconhecido não tem sessão. */
function paraSessao(linha: SessaoDoBanco | null): Sessao | null {
  if (!linha || linha.status !== STATUS_ATIVO) {
    return null;
  }
  const perfil = PERFIS.find((p) => p === linha.perfil);
  if (!perfil) {
    return null;
  }
  return {
    idOperador: linha.idOperador,
    usuario: linha.usuario,
    nome: linha.usuario,
    email: linha.email,
    perfil,
  };
}
