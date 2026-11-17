// RNF06, UC16-A1 — idempotência das mutações pelo cabeçalho `Idempotency-Key`: reenviar a mesma
// requisição (ex.: fila offline do frontend) devolve a mesma resposta sem repetir o efeito.
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError, ErroDeValidacao, STATUS_HTTP } from '../../erros';
import { obterSessao } from './autenticacao';

export const CABECALHO_IDEMPOTENCY_KEY = 'Idempotency-Key';
export const CABECALHO_REPLAY = 'Idempotency-Replayed';

/** Validade padrão de uma chave: cobre reenvios imediatos, não vira cache de longo prazo. */
export const TTL_PADRAO_DA_IDEMPOTENCIA_MS = 10 * 60 * 1000;
/** Máximo de chaves guardadas; ao encher, a mais antiga sai (a memória não cresce sem limite). */
export const MAXIMO_PADRAO_DE_CHAVES = 1000;
const TAMANHO_MAXIMO_DA_CHAVE = 255;
const PADRAO_DA_CHAVE = /^[\x21-\x7e]+$/;

export interface OpcoesDeIdempotencia {
  readonly ttlMs?: number;
  readonly maximoDeChaves?: number;
  /** Relógio em ms; os testes injetam o deles. */
  readonly agora?: () => number;
}

interface Entrada {
  readonly hashDoCorpo: string;
  readonly expiraEm: number;
  resposta?: { readonly status: number; readonly corpo: unknown };
}

function hashDe(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

/**
 * Repete a resposta de uma mutação já concluída com sucesso (2xx) para a mesma chave, usuário,
 * método e rota, sem reexecutá-la. Mesma chave com corpo diferente: `422`. Requisição igual ainda
 * em andamento: `409`. Respostas de erro não são guardadas, então a nova tentativa executa.
 * Sem o cabeçalho, não faz nada.
 *
 * Use depois de `exigirSessao` (a chave é por usuário) e nunca em rotas de autenticação: a
 * memória guarda o corpo da resposta, e ela não pode conter segredo.
 */
export function idempotencia({
  ttlMs = TTL_PADRAO_DA_IDEMPOTENCIA_MS,
  maximoDeChaves = MAXIMO_PADRAO_DE_CHAVES,
  agora = Date.now,
}: OpcoesDeIdempotencia = {}): RequestHandler {
  // Todas as entradas têm o mesmo TTL: a ordem de inserção do Map é também a ordem de expiração.
  const entradas = new Map<string, Entrada>();

  function limpar(instante: number): void {
    for (const [chave, entrada] of entradas) {
      if (entrada.expiraEm > instante && entradas.size < maximoDeChaves) {
        break;
      }
      entradas.delete(chave);
    }
  }

  return (req, res, next) => {
    const chaveDoCliente = req.get(CABECALHO_IDEMPOTENCY_KEY);
    if (chaveDoCliente === undefined) {
      next();
      return;
    }
    if (chaveDoCliente.length > TAMANHO_MAXIMO_DA_CHAVE || !PADRAO_DA_CHAVE.test(chaveDoCliente)) {
      next(
        new ErroDeValidacao({
          mensagem: `O cabeçalho ${CABECALHO_IDEMPOTENCY_KEY} deve ter de 1 a ${TAMANHO_MAXIMO_DA_CHAVE} caracteres ASCII visíveis.`,
        }),
      );
      return;
    }

    const instante = agora();
    const rota = req.originalUrl.split('?')[0] ?? '';
    const idDaEntrada = hashDe(
      [obterSessao(res).idOperador, req.method, rota, chaveDoCliente].join('\n'),
    );
    const hashDoCorpo = hashDe(JSON.stringify(req.body ?? null));

    limpar(instante);
    const existente = entradas.get(idDaEntrada);
    if (existente) {
      if (existente.hashDoCorpo !== hashDoCorpo) {
        next(new AppError('IDEMPOTENCY_KEY_REUSADA'));
        return;
      }
      const { resposta } = existente;
      if (!resposta) {
        next(new AppError('REQUISICAO_EM_ANDAMENTO'));
        return;
      }
      res.setHeader(CABECALHO_REPLAY, 'true').status(resposta.status);
      if (resposta.corpo === undefined) {
        res.end();
      } else {
        res.json(resposta.corpo);
      }
      return;
    }

    const entrada: Entrada = { hashDoCorpo, expiraEm: instante + ttlMs };
    entradas.set(idDaEntrada, entrada);
    let corpo: unknown;
    const jsonOriginal = res.json.bind(res);
    res.json = (valor: unknown) => {
      corpo = valor;
      return jsonOriginal(valor);
    };
    res.once('finish', () => {
      if (res.statusCode >= STATUS_HTTP.OK && res.statusCode < STATUS_HTTP.REQUISICAO_INVALIDA) {
        entrada.resposta = { status: res.statusCode, corpo };
      } else if (entradas.get(idDaEntrada) === entrada) {
        entradas.delete(idDaEntrada);
      }
    });
    res.once('close', () => {
      if (!entrada.resposta && entradas.get(idDaEntrada) === entrada) {
        entradas.delete(idDaEntrada);
      }
    });
    next();
  };
}
