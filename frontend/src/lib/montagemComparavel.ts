import type { CondicaoPagamento, OrigemTransportadora } from '@/api';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { textoNormalizado } from '@/lib/useAvisoNaoSalvo';

/**
 * Formas canônicas (texto JSON) do que a montagem do orçamento edita, para o aviso de alterações
 * não salvas (RNF06). Os dois lados da comparação (o que está na tela e o último orçamento lido)
 * passam pela mesma função, então máscara, espaços, vazio vs nulo e número vs texto não geram
 * falso aviso. Dinheiro sempre em centavos inteiros, nunca pelo texto formatado.
 */

export interface EntradaCabecalho {
  contato: string | null;
  solicitacao: string | null;
  endereco: string | number | null;
  prazoEntrega: string | number | null;
}

const numeroOuVazio = (v: string | number | null | undefined): number | '' => {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  const n = Number(v);
  return Number.isNaN(n) ? '' : n;
};

export function cabecalhoComparavel(e: EntradaCabecalho): string {
  return JSON.stringify({
    contato: textoNormalizado(e.contato),
    solicitacao: textoNormalizado(e.solicitacao),
    endereco: numeroOuVazio(e.endereco),
    prazoEntrega: numeroOuVazio(e.prazoEntrega),
  });
}

export interface EntradaCondicoes {
  pagamento: CondicaoPagamento | '';
  prazoDias: string | number | null;
  parcelas: string | number | null;
  /** Frete FOB: só nele a origem, a transportadora e o frete valem. */
  ehFob: boolean;
  origem: OrigemTransportadora;
  transportadora: string | null;
  /** Texto digitado ("1.500,50") ou centavos inteiros (valor lido do backend); vazio = sem frete. */
  frete: string | number | null;
}

/** Centavos inteiros; texto vazio = null; texto inválido fica marcado para diferir de qualquer valor lido. */
function freteEmCentavos(frete: string | number | null): number | string | null {
  if (frete === null) return null;
  if (typeof frete === 'number') return frete;
  const t = frete.trim();
  if (t === '') return null;
  return reaisParaCentavos(t) ?? `?${t}`;
}

export function condicoesComparaveis(e: EntradaCondicoes): string {
  return JSON.stringify({
    pagamento: e.pagamento,
    // Só o campo da condição escolhida é enviado ao backend; os outros não contam.
    prazoDias: e.pagamento === 'BOLETO' ? numeroOuVazio(e.prazoDias) : null,
    parcelas: e.pagamento === 'PARCELADO' ? numeroOuVazio(e.parcelas) : null,
    origem: e.ehFob ? e.origem : null,
    transportadora: e.ehFob ? textoNormalizado(e.transportadora) : null,
    frete: e.ehFob && e.origem === 'SUPRIMAX' ? freteEmCentavos(e.frete) : null,
  });
}
