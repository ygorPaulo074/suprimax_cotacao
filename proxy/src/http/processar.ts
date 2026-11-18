import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { z } from 'zod';
import { Auditoria, type ResultadoRisco } from '../auditoria/auditoria';
import {
  autenticarAdmin,
  autenticarIntegrante,
  type Cabecalhos,
  type CacheReplay,
  type ContextoAutenticado,
} from '../auth/autenticacao';
import type { RepositorioIntegrantes } from '../auth/integrantes';
import { exigirEscopos } from '../auth/escopos';
import { ErroBanco, type Executor } from '../banco/executor';
import { Armazenamento } from '../armazenamento/armazenamento';
import type { Config } from '../config';
import { AppError, corpoDoErro } from '../erros';
import type { Esquema } from '../esquema/esquema';
import type { FilaEscrita } from '../fila/fila';
import { podeLerCredenciais } from '../operacoes/dados';
import { erroDeRegraDoBanco } from '../operacoes/nomeadas';
import { OPERACOES } from '../operacoes/registro';
import { analisar, type ContextoOperacao } from '../operacoes/tipos';

// Fluxo de cada requisição (docs/12, seção 12.2): valida o envelope, confere token e escopo,
// verifica o risco estrutural e só então executa. Toda requisição gera uma entrada de auditoria.

export interface DepsServidor {
  config: Config;
  esquema: Esquema;
  banco: Executor;
  integrantes: RepositorioIntegrantes;
  fila: FilaEscrita;
  auditoria: Auditoria;
  replay: CacheReplay;
  logger: Logger;
  agora: () => Date;
  /** Storage de anexos; se ausente, é criado a partir da config (SUPABASE_URL e chave de serviço). */
  armazenamento?: Armazenamento;
}

export interface Requisicao {
  headers: Cabecalhos;
  corpoBruto: string;
  corpo: unknown;
  ip: string | null;
  /** Chamado logo após a autenticação, com o service_id validado (limite por integrante). Pode lançar AppError. */
  aposAutenticar?: (serviceId: string) => void;
}

export interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

const SchemaEnvelope = z
  .object({ operacao: z.string().min(1).max(100), payload: z.record(z.unknown()).default({}) })
  .strict();

/** Erros do banco de regra de integridade (CHECK, UNIQUE, FK, gatilhos) viram 400; o resto, 500. */
export function normalizarErro(e: unknown): AppError {
  if (e instanceof AppError) return e;
  // Regra levantada por gatilho em dados.* (RAISE EXCEPTION 'CODIGO'): mesmo tratamento das nomeadas.
  const regra = erroDeRegraDoBanco(e);
  if (regra) return regra;
  if (e instanceof ErroBanco && e.codigoSql?.startsWith('23')) {
    return new AppError('PAYLOAD_INVALIDO', undefined, e.message);
  }
  return new AppError('INTERNAL_ERROR', undefined, e instanceof Error ? e.message : String(e));
}

const ARMAZENAMENTOS = new WeakMap<DepsServidor, Armazenamento>();

function armazenamentoDe(deps: DepsServidor): Armazenamento {
  if (deps.armazenamento) return deps.armazenamento;
  let a = ARMAZENAMENTOS.get(deps);
  if (!a) {
    a = new Armazenamento(deps.config.supabaseUrl, deps.config.supabaseServiceRoleKey);
    ARMAZENAMENTOS.set(deps, a);
  }
  return a;
}

/**
 * Usuário que originou a operação, declarado pelo integrante no cabeçalho opcional X-User-Id (no
 * Sistema 2, o id_operador da sessão). Vai só para `log_auditoria.id_usuario`. O formato é restrito
 * (até 40 letras, dígitos, `_` ou `-`) para que nunca caiba ali um token ou um hash de sessão
 * (64 caracteres); fora dele, o valor é descartado (id_usuario nulo) e a operação segue: um campo só de
 * auditoria não derruba a operação.
 */
export const CABECALHO_ID_USUARIO = 'x-user-id';
const FORMATO_ID_USUARIO = /^[A-Za-z0-9_-]{1,40}$/;

export function lerIdUsuario(headers: Cabecalhos, avisar?: () => void): string | null {
  const v = headers[CABECALHO_ID_USUARIO];
  const bruto = (Array.isArray(v) ? v[0] : v)?.trim();
  if (!bruto) return null;
  if (!FORMATO_ID_USUARIO.test(bruto)) {
    avisar?.(); // sem o valor: ele pode ser um token ou um hash
    return null;
  }
  return bruto;
}

/** Contexto de execução de uma operação para um integrante autenticado (também na retomada). */
export function montarContexto(
  deps: DepsServidor,
  auth: ContextoAutenticado,
  registrarRisco: (r: ResultadoRisco) => void,
): ContextoOperacao {
  return {
    esquema: deps.esquema,
    banco: deps.banco,
    auth,
    deps: {
      integrantes: deps.integrantes,
      segredoJwt: deps.config.jwtSigningSecret,
      agora: deps.agora,
    },
    credenciais: podeLerCredenciais(auth.escopos),
    armazenamento: armazenamentoDe(deps),
    registrarRisco,
  };
}

export async function processar(deps: DepsServidor, req: Requisicao): Promise<Resposta> {
  const requestId = randomUUID();
  const inicio = Date.now();
  let operacao = 'desconhecida';
  let sistema = 'desconhecido';
  let risco: ResultadoRisco = 'NAO_APLICAVEL';
  let codigo = 'ok';
  let idUsuario: string | null = null;

  try {
    // A chave mestra vale só para integrante.*; o resto exige token de integrante.
    const nomeBruto = (req.corpo as { operacao?: unknown } | null)?.operacao;
    const ehAdmin = typeof nomeBruto === 'string' && nomeBruto.startsWith('integrante.');
    const depsAuth = {
      segredoJwt: deps.config.jwtSigningSecret,
      chaveAdmin: deps.config.proxyAdminKey,
      toleranciaSegundos: deps.config.toleranciaTimestampSegundos,
      integrantes: deps.integrantes,
      replay: deps.replay,
      agora: deps.agora,
    };
    const auth: ContextoAutenticado = ehAdmin
      ? autenticarAdmin(depsAuth, req.headers, req.corpoBruto)
      : await autenticarIntegrante(depsAuth, req.headers, req.corpoBruto);
    sistema = auth.serviceId;
    req.aposAutenticar?.(auth.serviceId);
    // Só depois da autenticação: quem não se identificou não atribui a operação a ninguém.
    idUsuario = lerIdUsuario(req.headers, () =>
      deps.logger.warn({ requestId }, 'X-User-Id fora do formato: id_usuario gravado nulo'),
    );

    const envelope = analisar(SchemaEnvelope, req.corpo);
    operacao = envelope.operacao;
    const op = OPERACOES.get(envelope.operacao);
    if (!op) throw new AppError('OPERACAO_DESCONHECIDA');

    const ctx = montarContexto(deps, auth, (r) => {
      risco = r;
    });

    const preparada = op.preparar(envelope.payload, ctx);
    exigirEscopos(auth.escopos, preparada.escopos);

    // `somenteLeitura` só vem da própria operação (lote cujos passos são todos leituras conhecidas).
    // Na fila, a operação é preparada de novo sobre a transação da fila, para que a escrita e a
    // marcação `concluido` sejam confirmadas juntas (fila.ts).
    const resultado =
      op.escrita && !preparada.somenteLeitura
        ? await deps.fila.executar(
            {
              sistemaOrigem: sistema,
              dominio: preparada.dominio,
              operacao: op.id,
              payload: op.admin || op.sigilosa ? null : envelope.payload,
            },
            (tx) => op.preparar(envelope.payload, { ...ctx, banco: tx }).executar(),
            deps.banco,
          )
        : await preparada.executar();
    return { status: 200, corpo: { ok: true, ...resultado } };
  } catch (e) {
    const erro = normalizarErro(e);
    codigo = erro.codigo;
    if (erro.codigo === 'INTERNAL_ERROR' || erro.motivoInterno) {
      deps.logger.warn(
        { requestId, codigo: erro.codigo, motivo: erro.motivoInterno },
        'erro na requisicao',
      );
    }
    return { status: erro.status, corpo: { ...corpoDoErro(erro) } };
  } finally {
    await deps.auditoria.registrar({
      timestamp: deps.agora(),
      sistemaOrigem: sistema,
      operacao,
      resultadoVerificacaoRisco: risco,
      statusExecucao: codigo === 'ok' ? 'SUCESSO' : 'ERRO',
      duracaoMs: Date.now() - inicio,
      requestId,
      resultado: codigo,
      idUsuario,
      ipOrigem: req.ip,
    });
  }
}
