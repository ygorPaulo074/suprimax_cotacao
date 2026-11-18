import {
  dadosAtualizar,
  dadosConsultar,
  dadosExcluir,
  dadosInserir,
  dadosLote,
  dadosRpc,
} from './dados';
import { arquivoAssinar, arquivoRemover, arquivoSalvar } from './arquivos';
import { integranteCriar, integranteRevogar } from './integrantes';
import { orcamentoEmitir, pedidoAssumir, respostaProcessar } from './nomeadas';
import { OPERACOES_DE_SESSAO } from './sessoes';
import type { Operacao } from './tipos';

/** Catálogo de operações reconhecidas pelo proxy (docs/12, seção 12.8). */
export const OPERACOES: ReadonlyMap<string, Operacao> = new Map(
  [
    dadosConsultar,
    dadosInserir,
    dadosAtualizar,
    dadosExcluir,
    dadosLote,
    dadosRpc,
    pedidoAssumir,
    orcamentoEmitir,
    respostaProcessar,
    arquivoSalvar,
    arquivoRemover,
    arquivoAssinar,
    integranteCriar,
    integranteRevogar,
    ...OPERACOES_DE_SESSAO,
  ].map((o) => [o.id, o]),
);
