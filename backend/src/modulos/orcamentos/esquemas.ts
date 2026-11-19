// UC01, UC14-19 — esquemas zod do módulo de orçamentos.
import { z } from 'zod';
import {
  esquemaDeCentavos,
  esquemaDeId,
  esquemaDeDataISO,
  esquemaDeQuantidade,
  textoOpcional,
} from '../comum/campos';
import { esquemaDeParametrosDePagina } from '../comum/paginacao';
import { GRANULARIDADES } from '../pedidos/repositorio';
import {
  CONDICOES_DE_PAGAMENTO,
  ORIGENS_DE_TRANSPORTADORA,
  STATUS_DO_ORCAMENTO,
  TIPOS_DE_ANEXO,
} from './repositorio';

const TAMANHO_MAXIMO_DO_NUMERO_DE_SOLICITACAO = 30;
const TAMANHO_MAXIMO_DO_CONTATO = 100;
const TAMANHO_MAXIMO_DA_TRANSPORTADORA = 100;
const TAMANHO_MAXIMO_DA_JUSTIFICATIVA = 2000;
const PRAZOS_DE_BOLETO = [10, 15, 20, 28, 30] as const;
const MAXIMO_DE_PARCELAS = 6;

/** `POST /orcamentos`: novo orçamento do zero (UC14, sem pedido de origem). */
export const esquemaDeOrcamentoNovo = z.object({
  idCliente: esquemaDeId,
  idEnderecoEntrega: esquemaDeId.nullish(),
  numeroSolicitacaoCompra: textoOpcional(TAMANHO_MAXIMO_DO_NUMERO_DE_SOLICITACAO),
  contatoSolicitacao: textoOpcional(TAMANHO_MAXIMO_DO_CONTATO),
  prazoEntregaDias: z.number().int().positive().nullish(),
});

/** Data 'AAAA-MM-DD' que existe no calendário (rejeita, por exemplo, 2026-02-31). */
const dataExistente = esquemaDeDataISO.refine((texto) => {
  const data = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(texto);
}, 'data inválida');

/** `GET /orcamentos`: filtros da listagem (UC01). */
export const esquemaDeFiltroDeOrcamentos = z.object({
  status: z.enum(STATUS_DO_ORCAMENTO).optional(),
  cliente: z.string().trim().min(1).optional(),
  cnpj: z.string().trim().min(1).optional(),
  numero: z.string().trim().min(1).optional(),
  de: dataExistente.optional(),
  ate: dataExistente.optional(),
  ...esquemaDeParametrosDePagina.shape,
});

/** `PATCH /orcamentos/:id`: cabeçalho (UC14). */
export const esquemaDeCabecalhoAtualizar = z.object({
  numeroSolicitacaoCompra: textoOpcional(TAMANHO_MAXIMO_DO_NUMERO_DE_SOLICITACAO).optional(),
  contatoSolicitacao: textoOpcional(TAMANHO_MAXIMO_DO_CONTATO).optional(),
  idEnderecoEntrega: esquemaDeId.nullish(),
  prazoEntregaDias: z.number().int().positive().nullish(),
});

/** `POST /orcamentos/:id/itens`: item novo (UC15). */
export const esquemaDeItemAdicionar = z
  .object({
    idVariacao: esquemaDeId,
    granularidade: z.enum(GRANULARIDADES),
    idFardo: esquemaDeId.optional(),
    quantidade: esquemaDeQuantidade,
  })
  .refine((dados) => dados.granularidade !== 'FARDO' || dados.idFardo !== undefined, {
    message: 'idFardo é obrigatório quando granularidade é FARDO.',
    path: ['idFardo'],
  });

/** `PATCH /orcamentos/:id/itens/:idItem`: nova quantidade (UC16). */
export const esquemaDeQuantidadeAlterar = z.object({ quantidade: esquemaDeQuantidade });

/** `PUT /orcamentos/:id/condicoes`: condições comerciais escolhidas pelo operador (UC18). */
export const esquemaDeCondicoesAtualizar = z
  .object({
    condicaoPagamento: z.enum(CONDICOES_DE_PAGAMENTO).optional(),
    prazoDias: z
      .number()
      .int()
      .refine((valor): valor is (typeof PRAZOS_DE_BOLETO)[number] =>
        PRAZOS_DE_BOLETO.includes(valor as (typeof PRAZOS_DE_BOLETO)[number]),
      )
      .optional(),
    numeroParcelas: z.number().int().min(2).max(MAXIMO_DE_PARCELAS).optional(),
    origemTransportadora: z.enum(ORIGENS_DE_TRANSPORTADORA).optional(),
    transportadora: textoOpcional(TAMANHO_MAXIMO_DA_TRANSPORTADORA).optional(),
    valorFrete: esquemaDeCentavos.optional(),
  })
  .refine((dados) => dados.condicaoPagamento !== 'BOLETO' || dados.prazoDias !== undefined, {
    message: 'prazoDias é obrigatório para BOLETO.',
    path: ['prazoDias'],
  })
  .refine(
    (dados) => dados.condicaoPagamento !== 'PARCELADO' || dados.numeroParcelas !== undefined,
    { message: 'numeroParcelas é obrigatório para PARCELADO.', path: ['numeroParcelas'] },
  );

/** `POST /orcamentos/:id/cancelar`: justificativa opcional. */
export const esquemaDeCancelamento = z.object({
  justificativa: textoOpcional(TAMANHO_MAXIMO_DA_JUSTIFICATIVA).optional(),
});

/**
 * `POST /orcamentos/:id/anexos`: campo de texto do multipart (o arquivo em si vem por
 * `multer`, conferido separadamente em `rotas.ts`).
 */
export const esquemaDeAnexoNovo = z.object({
  tipoAnexo: z.enum(TIPOS_DE_ANEXO),
});

export type DadosDoOrcamentoNovo = z.infer<typeof esquemaDeOrcamentoNovo>;
export type FiltroDeOrcamentos = z.infer<typeof esquemaDeFiltroDeOrcamentos>;
export type DadosDoCabecalhoAtualizar = z.infer<typeof esquemaDeCabecalhoAtualizar>;
export type DadosDoItemAdicionar = z.infer<typeof esquemaDeItemAdicionar>;
export type DadosDaQuantidadeAlterar = z.infer<typeof esquemaDeQuantidadeAlterar>;
export type DadosDasCondicoesAtualizar = z.infer<typeof esquemaDeCondicoesAtualizar>;
export type DadosDoCancelamento = z.infer<typeof esquemaDeCancelamento>;
export type DadosDoAnexoNovo = z.infer<typeof esquemaDeAnexoNovo>;
