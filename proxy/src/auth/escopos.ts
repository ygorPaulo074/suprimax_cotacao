import { AppError } from '../erros';

// Escopos (docs/12, seção 12.3): `tabela:acao` (acao em consultar, inserir, atualizar, excluir),
// `*:acao` para todas as tabelas, `rpc:<funcao>` e `operacao:<identificador>`.

export const ACOES = ['consultar', 'inserir', 'atualizar', 'excluir'] as const;
export type Acao = (typeof ACOES)[number];

const RECURSOS_ESPECIAIS = ['rpc', 'operacao'];
const FORMATO = /^[a-z0-9_.*]+:[a-z0-9_.*]+$/;

/** Tabela comum: sem ponto e que não seja um recurso especial. */
function ehTabela(recurso: string): boolean {
  return !recurso.includes('.') && !RECURSOS_ESPECIAIS.includes(recurso) && recurso !== '*';
}

export function validarEscopos(escopos: string[]): void {
  for (const escopo of escopos) {
    if (!FORMATO.test(escopo))
      throw new AppError('PAYLOAD_INVALIDO', undefined, `escopo inválido: ${escopo}`);
    const [recurso = '', acao = ''] = escopo.split(':');
    const especial = RECURSOS_ESPECIAIS.includes(recurso) || recurso.includes('.');
    if (!especial && !(ACOES as readonly string[]).includes(acao)) {
      throw new AppError('PAYLOAD_INVALIDO', undefined, `ação inválida no escopo: ${escopo}`);
    }
  }
}

/**
 * O integrante possui o escopo exigido? Vale a correspondência exata; `*:acao` cobre qualquer
 * tabela (não cobre `operador.credenciais:consultar`); `rpc:*` e `operacao:*` cobrem qualquer função
 * ou operação nomeada.
 */
export function possuiEscopo(concedidos: string[], exigido: string): boolean {
  if (concedidos.includes(exigido)) return true;
  const [recurso = '', acao = ''] = exigido.split(':');
  if (ehTabela(recurso) && concedidos.includes(`*:${acao}`)) return true;
  if (RECURSOS_ESPECIAIS.includes(recurso) && concedidos.includes(`${recurso}:*`)) return true;
  return false;
}

/** Lança ESCOPO_NEGADO se faltar algum dos escopos exigidos. */
export function exigirEscopos(concedidos: string[], exigidos: string[]): void {
  const faltando = exigidos.filter((e) => !possuiEscopo(concedidos, e));
  if (faltando.length > 0) {
    // O cliente só recebe o código; o escopo faltante vai para o log.
    throw new AppError('ESCOPO_NEGADO', undefined, `faltam: ${faltando.join(', ')}`);
  }
}
