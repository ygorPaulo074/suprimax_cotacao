import type { DepsServidor } from '../http/processar';
import type { RepositorioFila } from './fila';

// Tratamento da fila de escrita na subida do proxy (docs/12, seção 12.5). A fila NÃO reexecuta o
// que ficou pendente: a escrita e a marcação `concluido` são confirmadas na mesma transação, então
// um item `pendente`/`processando` encontrado ao subir NÃO tem efeito no banco, e o chamador já
// recebeu erro (503/500) e confere o estado antes de repetir. Reexecutá-lo faria a escrita aparecer
// depois, e o reenvio do chamador a duplicaria (a idempotência do backend não guarda erros).
//
// Por isso a subida só marca `erro` (motivo claro) esses itens, numa única instrução, e audita cada
// um. Só entram os criados ANTES do início deste processo: se a instrução demorar (banco
// acordando), as escritas novas, registradas depois, não são tocadas, e a ordem da fila não é
// afetada, porque nada é enfileirado aqui.

export const MOTIVO_INTERRUPCAO = 'interrompido por reinício; verifique o estado antes de repetir';
/** Valor de `resultado` na auditoria de um item interrompido. */
export const RESULTADO_INTERRUPCAO = 'INTERROMPIDO_REINICIO';

export interface ResumoRetomada {
  interrompidos: number;
}

/**
 * Marca `erro` os itens pendentes/processando criados antes de `inicioDoProcesso`. Nunca lança:
 * uma falha só vai para o log, e o proxy sobe mesmo assim. Cada item gera uma entrada de auditoria
 * (request_id = id do item), gravada em sequência sem bloquear quem a chamou além do necessário.
 */
export async function retomarFila(
  deps: DepsServidor,
  repositorio: RepositorioFila,
  inicioDoProcesso: Date = deps.agora(),
): Promise<ResumoRetomada> {
  let itens;
  try {
    itens = await repositorio.interromper(MOTIVO_INTERRUPCAO, inicioDoProcesso);
  } catch (e) {
    deps.logger.error({ err: e }, 'falha ao marcar a fila de escrita interrompida no reinício');
    return { interrompidos: 0 };
  }
  for (const item of itens) {
    deps.logger.warn(
      { item: item.id, operacao: item.operacao, tentativas: item.tentativas },
      'item da fila interrompido por reinício marcado como erro (sem reexecução)',
    );
    await deps.auditoria.registrar({
      timestamp: deps.agora(),
      sistemaOrigem: item.sistemaOrigem,
      operacao: item.operacao,
      resultadoVerificacaoRisco: 'NAO_APLICAVEL',
      statusExecucao: 'ERRO',
      duracaoMs: 0,
      requestId: item.id,
      resultado: RESULTADO_INTERRUPCAO,
      // fila_escrita não guarda o usuário (o schema não mudou).
      idUsuario: null,
      ipOrigem: null,
    });
  }
  if (itens.length > 0) deps.logger.info({ interrompidos: itens.length }, 'fila interrompida');
  return { interrompidos: itens.length };
}
