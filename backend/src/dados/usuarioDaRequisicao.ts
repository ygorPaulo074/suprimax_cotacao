// Usuário que originou a requisição em andamento, para a auditoria do proxy (docs/12, seções 12.3
// e 12.7: cabeçalho X-User-Id -> log_auditoria.id_usuario). `exigirSessao` abre o contexto com o
// id_operador da sessão, e o cliente do proxy o lê ao montar os cabeçalhos, sem que os
// repositórios precisem repassá-lo. Fora de uma requisição autenticada (login, jobs), não há
// usuário e o cabeçalho não é enviado. Só o id numérico: nunca token, hash de sessão ou senha.
import { AsyncLocalStorage } from 'node:async_hooks';

interface ContextoDoUsuario {
  readonly idOperador: number;
}

const contexto = new AsyncLocalStorage<ContextoDoUsuario>();

/** Executa `fn` (e tudo o que ela disparar de forma assíncrona) em nome do operador. */
export function executarComoOperador<T>(idOperador: number, fn: () => T): T {
  return contexto.run({ idOperador }, fn);
}

/** id_operador da requisição em andamento, ou `undefined` fora de uma requisição autenticada. */
export function operadorDaRequisicao(): number | undefined {
  return contexto.getStore()?.idOperador;
}
