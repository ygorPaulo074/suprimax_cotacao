import {
  dadosAtualizar,
  dadosConsultar,
  dadosExcluir,
  dadosInserir,
  dadosLote,
  dadosRpc,
} from './dados';
import { integranteCriar, integranteRevogar } from './integrantes';
import { orcamentoEmitir, pedidoAssumir, respostaProcessar } from './nomeadas';
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
    integranteCriar,
    integranteRevogar,
  ].map((o) => [o.id, o]),
);
