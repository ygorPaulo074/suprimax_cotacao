// Item 2 do backend/TAREFAS.md — o que o backend faz com cada erro do proxy
// (comunicacao-backend-proxy.md, seção 6; docs/12, seções 12.8.3 e 12.8.6).
import {
  ErroDeServicoIndisponivel,
  ErroDeValidacao,
  ErroInterno,
  STATUS_HTTP,
  type AppError,
} from '../erros';
import type { ErroProxy } from './proxyCliente';

/** Códigos de erro devolvidos pelo proxy. */
export const CODIGOS_DO_PROXY = {
  PAYLOAD_INVALIDO: 'PAYLOAD_INVALIDO',
  TOKEN_INVALIDO: 'TOKEN_INVALIDO',
  ESCOPO_NEGADO: 'ESCOPO_NEGADO',
  OPERACAO_DESCONHECIDA: 'OPERACAO_DESCONHECIDA',
  NOT_FOUND: 'NOT_FOUND',
  PEDIDO_JA_ASSUMIDO: 'PEDIDO_JA_ASSUMIDO',
  ESTOQUE_INSUFICIENTE: 'ESTOQUE_INSUFICIENTE',
  ORCAMENTO_NAO_EDITAVEL: 'ORCAMENTO_NAO_EDITAVEL',
  CHAVE_DUPLICADA: 'CHAVE_DUPLICADA',
  RESPOSTA_JA_PROCESSADA: 'RESPOSTA_JA_PROCESSADA',
  RISCO_ESTRUTURAL: 'RISCO_ESTRUTURAL',
  LIMITE_EXCEDIDO: 'LIMITE_EXCEDIDO',
  OPERACAO_NAO_IMPLEMENTADA: 'OPERACAO_NAO_IMPLEMENTADA',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/**
 * Códigos cujo tratamento depende da operação e da tela (conflito de estado, registro
 * inexistente). O cliente os repassa como ErroProxy, e o módulo que chamou decide a resposta.
 */
export const CODIGOS_REPASSADOS_A_QUEM_CHAMOU: ReadonlySet<string> = new Set([
  CODIGOS_DO_PROXY.NOT_FOUND,
  CODIGOS_DO_PROXY.PEDIDO_JA_ASSUMIDO,
  CODIGOS_DO_PROXY.ESTOQUE_INSUFICIENTE,
  CODIGOS_DO_PROXY.ORCAMENTO_NAO_EDITAVEL,
  CODIGOS_DO_PROXY.CHAVE_DUPLICADA,
  CODIGOS_DO_PROXY.RESPOSTA_JA_PROCESSADA,
]);

/**
 * Códigos que sempre indicam defeito do backend ou da infraestrutura (escopo faltando, operação
 * errada, filtro perigoso, credencial vencida, excesso de requisições), em qualquer operação.
 */
export const CODIGOS_DE_FALHA_INTERNA: ReadonlySet<string> = new Set([
  CODIGOS_DO_PROXY.TOKEN_INVALIDO,
  CODIGOS_DO_PROXY.ESCOPO_NEGADO,
  CODIGOS_DO_PROXY.OPERACAO_DESCONHECIDA,
  CODIGOS_DO_PROXY.RISCO_ESTRUTURAL,
  CODIGOS_DO_PROXY.LIMITE_EXCEDIDO,
  CODIGOS_DO_PROXY.OPERACAO_NAO_IMPLEMENTADA,
  CODIGOS_DO_PROXY.INTERNAL_ERROR,
]);

/** Códigos de falha de comunicação do cliente (FALHAS_DE_COMUNICACAO, em proxyCliente.ts). */
const FALHA_DE_REDE = 'FALHA_DE_REDE';
const TEMPO_ESGOTADO = 'TEMPO_ESGOTADO';
const RESPOSTA_INVALIDA = 'RESPOSTA_INVALIDA';

/** Status de gateway: o Render devolve um deles, em HTML, enquanto o proxy ainda está acordando. */
const STATUS_DE_GATEWAY: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * O proxy não respondeu a tempo ou não está de pé (hibernado no Render, reiniciando, fora do ar).
 * Não é defeito do backend: o usuário só precisa tentar de novo em instantes.
 */
export function proxyEmEspera(erro: ErroProxy): boolean {
  if (erro.codigo === FALHA_DE_REDE || erro.codigo === TEMPO_ESGOTADO) {
    return true;
  }
  const statusRecebido = erro.detalhes?.statusRecebido;
  return (
    erro.codigo === RESPOSTA_INVALIDA &&
    typeof statusRecebido === 'number' &&
    STATUS_DE_GATEWAY.has(statusRecebido)
  );
}

/**
 * Traduz um erro do proxy no erro de aplicação que vale para qualquer operação.
 *
 * Proxy em espera (ver proxyEmEspera) vira ErroDeServicoIndisponivel (503), e não erro interno.
 *
 * A mensagem e os detalhes do proxy nunca vão para o frontend: o AppError devolvido leva só a
 * mensagem do catálogo do backend, e o ErroProxy original fica em `cause`, para o log e para quem
 * precisar distinguir o caso.
 *
 * @returns O AppError a lançar, ou `null` quando o erro deve ser repassado como ErroProxy: os
 * códigos de CODIGOS_REPASSADOS_A_QUEM_CHAMOU e qualquer código 4xx que o backend ainda não
 * conhece.
 */
export function traduzirErroDeProxy(erro: ErroProxy): AppError | null {
  if (CODIGOS_REPASSADOS_A_QUEM_CHAMOU.has(erro.codigo)) {
    return null;
  }
  if (erro.codigo === CODIGOS_DO_PROXY.PAYLOAD_INVALIDO) {
    return new ErroDeValidacao({ causa: erro });
  }
  if (proxyEmEspera(erro)) {
    return new ErroDeServicoIndisponivel({ causa: erro });
  }
  const foraDaFaixaDoCliente =
    erro.status < STATUS_HTTP.REQUISICAO_INVALIDA || erro.status >= STATUS_HTTP.ERRO_INTERNO;
  if (CODIGOS_DE_FALHA_INTERNA.has(erro.codigo) || foraDaFaixaDoCliente) {
    return new ErroInterno(erro);
  }
  return null;
}
