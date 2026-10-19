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
import type { Config } from '../config';
import { AppError, corpoDoErro } from '../erros';
import type { Esquema } from '../esquema/esquema';
import type { FilaEscrita } from '../fila/fila';
import { podeLerCredenciais } from '../operacoes/dados';
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
}

export interface Requisicao {
  headers: Cabecalhos;
  corpoBruto: string;
  corpo: unknown;
  ip: string | null;
}

export interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
}

const SchemaEnvelope = z
  .object({ operacao: z.string().min(1).max(100), payload: z.record(z.unknown()).default({}) })
  .strict();

/** Erros do banco de regra de integridade (CHECK, UNIQUE, FK, gatilhos) viram 400; o resto, 500. */
function normalizarErro(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ErroBanco && e.codigoSql?.startsWith('23')) {
    return new AppError('PAYLOAD_INVALIDO', undefined, e.message);
  }
  return new AppError('INTERNAL_ERROR', undefined, e instanceof Error ? e.message : String(e));
}

export async function processar(deps: DepsServidor, req: Requisicao): Promise<Resposta> {
  const requestId = randomUUID();
  const inicio = Date.now();
  let operacao = 'desconhecida';
  let sistema = 'desconhecido';
  let risco: ResultadoRisco = 'NAO_APLICAVEL';
  let codigo = 'ok';

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

    const envelope = analisar(SchemaEnvelope, req.corpo);
    operacao = envelope.operacao;
    const op = OPERACOES.get(envelope.operacao);
    if (!op) throw new AppError('OPERACAO_DESCONHECIDA');

    const ctx: ContextoOperacao = {
      esquema: deps.esquema,
      banco: deps.banco,
      auth,
      deps: {
        integrantes: deps.integrantes,
        segredoJwt: deps.config.jwtSigningSecret,
        agora: deps.agora,
      },
      credenciais: podeLerCredenciais(auth.escopos),
      registrarRisco: (r) => {
        risco = r;
      },
    };

    const preparada = op.preparar(envelope.payload, ctx);
    exigirEscopos(auth.escopos, preparada.escopos);

    const resultado = op.escrita
      ? await deps.fila.executar(
          {
            sistemaOrigem: sistema,
            dominio: preparada.dominio,
            operacao: op.id,
            payload: op.admin ? null : envelope.payload,
          },
          preparada.executar,
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
      idUsuario: null,
      ipOrigem: req.ip,
    });
  }
}
