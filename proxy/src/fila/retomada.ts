import type { ResultadoRisco } from '../auditoria/auditoria';
import type { ContextoAutenticado } from '../auth/autenticacao';
import { exigirEscopos } from '../auth/escopos';
import { montarContexto, normalizarErro, type DepsServidor } from '../http/processar';
import { OPERACOES } from '../operacoes/registro';
import type { Operacao } from '../operacoes/tipos';
import type { ItemFila, RepositorioFila } from './fila';

// Retomada da fila de escrita após reinício do proxy (docs/12, seção 12.5). Roda no início, ANTES
// de o servidor aceitar requisições, para que nenhuma escrita nova passe na frente das antigas e
// para que o chamador, ao ler o estado depois de o proxy voltar, já veja o efeito.
//
// Cada item `pendente` ou `processando` é executado de novo pela própria fila (fila.ts), com a
// mesma garantia de exatamente uma vez: o item `processando` que sobrou de uma queda não teve
// efeito no banco (a transação foi desfeita), e a trava da linha impede que outra instância ainda
// viva o execute ao mesmo tempo. Os que não podem ou não devem ser retomados viram `erro`.

/** Itens mais antigos que isso não são retomados: quem pediu já recebeu erro há muito tempo. */
export const IDADE_MAXIMA_RETOMADA_MS = 15 * 60_000;
/** Um item que derrubou o proxy tantas vezes não é tentado de novo (evita laço de quedas). */
export const MAXIMO_TENTATIVAS_RETOMADA = 3;
/** Itens lidos por início; o resto fica para o próximo. */
export const LIMITE_RETOMADA = 500;

export interface ResumoRetomada {
  retomados: number;
  falharam: number;
  descartados: number;
}

const PREFIXO_DESCARTE = 'não retomado após reinício: ';

/** A operação a retomar, ou o motivo (texto) por que o item não pode ser retomado. */
function operacaoRetomavel(item: ItemFila, agora: Date): Operacao | string {
  if (agora.getTime() - item.criadoEm.getTime() > IDADE_MAXIMA_RETOMADA_MS) return 'expirado';
  if (item.tentativas >= MAXIMO_TENTATIVAS_RETOMADA) return 'tentativas esgotadas';
  const op = OPERACOES.get(item.operacao);
  if (!op || !op.escrita) return 'operação desconhecida';
  // Administração e sessões não gravam o payload na fila (sigiloso): não há o que repetir.
  if (op.admin || op.sigilosa || item.payload === null) return 'operação sem payload na fila';
  return op;
}

async function autenticacaoDoItem(
  deps: DepsServidor,
  item: ItemFila,
): Promise<ContextoAutenticado | null> {
  const integrante = await deps.integrantes.buscarPorId(item.sistemaOrigem);
  const agora = deps.agora();
  if (!integrante || !integrante.ativo || (integrante.expiraEm && integrante.expiraEm <= agora)) {
    return null;
  }
  return {
    serviceId: integrante.id,
    operationId: `retomada-fila:${item.id}`,
    // Os escopos de agora: um escopo revogado desde então barra a retomada.
    escopos: integrante.escopos,
    integrante,
    admin: false,
  };
}

/**
 * Retoma os itens pendentes da fila. Nunca lança: uma falha ao listar só vai para o log, e o
 * proxy sobe mesmo assim. Cada retomada gera uma entrada de auditoria (request_id = id do item).
 */
export async function retomarFila(
  deps: DepsServidor,
  repositorio: RepositorioFila,
): Promise<ResumoRetomada> {
  const resumo: ResumoRetomada = { retomados: 0, falharam: 0, descartados: 0 };
  let itens: ItemFila[];
  try {
    itens = await repositorio.listarRetomaveis(LIMITE_RETOMADA);
  } catch (e) {
    deps.logger.error({ err: e }, 'falha ao listar a fila de escrita para retomada');
    return resumo;
  }

  for (const item of itens) {
    const inicio = Date.now();
    let risco: ResultadoRisco = 'NAO_APLICAVEL';
    let codigo = 'ok';
    try {
      const op = operacaoRetomavel(item, deps.agora());
      const auth = typeof op === 'string' ? null : await autenticacaoDoItem(deps, item);
      if (typeof op === 'string' || !auth) {
        const motivo = typeof op === 'string' ? op : 'integrante inválido';
        await repositorio.falhar(item.id, PREFIXO_DESCARTE + motivo);
        resumo.descartados++;
        deps.logger.warn(
          { item: item.id, operacao: item.operacao, motivo },
          'item da fila descartado na retomada',
        );
        continue;
      }
      const ctx = montarContexto(deps, auth, (r) => {
        risco = r;
      });
      // Valida o payload e os escopos antes de tocar no banco, como numa requisição nova.
      exigirEscopos(auth.escopos, op.preparar(item.payload, ctx).escopos);
      await deps.fila.retomar(
        item.id,
        (tx) => op.preparar(item.payload, { ...ctx, banco: tx }).executar(),
        deps.banco,
      );
      resumo.retomados++;
    } catch (e) {
      const erro = normalizarErro(e);
      codigo = erro.codigo;
      resumo.falharam++;
      // A fila já marcou `erro` se chegou a executar; aqui cobre a validação recusada antes dela.
      await repositorio
        .falhar(item.id, PREFIXO_DESCARTE + (erro.motivoInterno ?? erro.codigo))
        .catch(() => undefined);
      deps.logger.warn(
        { item: item.id, operacao: item.operacao, codigo, motivo: erro.motivoInterno },
        'item da fila falhou na retomada',
      );
    }
    await deps.auditoria.registrar({
      timestamp: deps.agora(),
      sistemaOrigem: item.sistemaOrigem,
      operacao: item.operacao,
      resultadoVerificacaoRisco: risco,
      statusExecucao: codigo === 'ok' ? 'SUCESSO' : 'ERRO',
      duracaoMs: Date.now() - inicio,
      requestId: item.id,
      resultado: codigo,
      // fila_escrita não guarda o usuário (o schema não mudou): a retomada fica sem id_usuario.
      idUsuario: null,
      ipOrigem: null,
    });
  }
  if (itens.length > 0) deps.logger.info({ ...resumo }, 'retomada da fila de escrita');
  return resumo;
}
