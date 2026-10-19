import { z } from 'zod';
import { AppError, type CodigoErro } from '../erros';
import { ErroBanco } from '../banco/executor';
import { aspas, colunasVisiveis, SEM_CREDENCIAIS } from '../sql/base';
import { analisar, type ContextoOperacao, type Operacao } from './tipos';

// Operações nomeadas (docs/12, seção 12.8.3): exigem transação única e regra atômica.
//
// - pedido.assumir roda aqui, em um único UPDATE condicional.
// - orcamento.emitir e resposta.processar chamam funções do banco (uma função = uma transação),
//   que o responsável pelo banco implementa (ver proxy/README.md, "Contrato com o banco"). O proxy
//   só valida a entrada, chama a função e traduz o erro de negócio que ela levantar.

export const FUNCAO_EMITIR = 'proxy_orcamento_emitir';
export const FUNCAO_PROCESSAR = 'proxy_resposta_processar';

const CODIGOS_DE_NEGOCIO: CodigoErro[] = [
  'ESTOQUE_INSUFICIENTE',
  'ORCAMENTO_NAO_EDITAVEL',
  'CHAVE_DUPLICADA',
  'RESPOSTA_JA_PROCESSADA',
  'PEDIDO_JA_ASSUMIDO',
  'NOT_FOUND',
];

/**
 * As funções do banco sinalizam erro de negócio com `RAISE EXCEPTION 'CODIGO'` ou
 * `RAISE EXCEPTION 'CODIGO:{"chave":"valor"}'`. Qualquer outro erro do banco vira INTERNAL_ERROR
 * (a mensagem original só vai para o log).
 */
export function traduzirErroDoBanco(e: unknown): never {
  if (e instanceof AppError) throw e;
  if (e instanceof ErroBanco) {
    const m = /^([A-Z_]+)(?::(.*))?$/s.exec(e.message.trim());
    const codigo = m?.[1] as CodigoErro | undefined;
    if (codigo && CODIGOS_DE_NEGOCIO.includes(codigo)) {
      let detalhes: Record<string, unknown> | undefined;
      try {
        const bruto = m?.[2] ? (JSON.parse(m[2]) as unknown) : undefined;
        if (bruto && typeof bruto === 'object' && !Array.isArray(bruto))
          detalhes = bruto as Record<string, unknown>;
      } catch {
        /* detalhes ilegíveis: segue só com o código */
      }
      throw new AppError(codigo, detalhes, e.message);
    }
  }
  throw new AppError('INTERNAL_ERROR', undefined, e instanceof Error ? e.message : String(e));
}

const inteiro = z.number().int().positive();

// ---- pedido.assumir ------------------------------------------------------------------------

const SchemaAssumir = z.object({ id_pedido: inteiro, id_operador: inteiro }).strict();

async function assumirPedido(
  p: z.infer<typeof SchemaAssumir>,
  ctx: ContextoOperacao,
): Promise<Record<string, unknown>> {
  const colunas = colunasVisiveis(ctx.esquema, 'pedido', SEM_CREDENCIAIS).map(aspas).join(', ');
  return ctx.banco.transacao(async (tx) => {
    const r = await tx.consultar({
      texto:
        `UPDATE "pedido" SET "status" = 'EM_ANALISE', "id_operador_atendimento" = $2 ` +
        `WHERE "id_pedido" = $1 AND "status" = 'SOLICITADO' RETURNING ${colunas}`,
      valores: [p.id_pedido, p.id_operador],
    });
    if (r.contagem > 0) return { dados: r.linhas[0] };

    // Não mudou nenhuma linha: o pedido não existe ou já saiu de SOLICITADO.
    const existe = await tx.consultar({
      texto: 'SELECT 1 FROM "pedido" WHERE "id_pedido" = $1',
      valores: [p.id_pedido],
    });
    throw new AppError(existe.contagem > 0 ? 'PEDIDO_JA_ASSUMIDO' : 'NOT_FOUND');
  });
}

export const pedidoAssumir: Operacao = {
  id: 'pedido.assumir',
  escrita: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaAssumir, payload);
    return {
      escopos: ['operacao:pedido.assumir'],
      dominio: 'pedido',
      executar: () => assumirPedido(p, ctx),
    };
  },
};

// ---- orcamento.emitir ----------------------------------------------------------------------

const SchemaEmitir = z
  .object({
    id_orcamento: inteiro,
    id_operador: inteiro,
    chave_seguranca: z.string().min(16).max(255),
  })
  .strict();

export const orcamentoEmitir: Operacao = {
  id: 'orcamento.emitir',
  escrita: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaEmitir, payload);
    return {
      escopos: ['operacao:orcamento.emitir'],
      dominio: 'orcamento',
      async executar() {
        try {
          const r = await ctx.banco.transacao((tx) =>
            tx.consultar({
              texto: `SELECT * FROM ${aspas(FUNCAO_EMITIR)}(p_id_orcamento => $1, p_id_operador => $2, p_chave_seguranca => $3)`,
              valores: [p.id_orcamento, p.id_operador, p.chave_seguranca],
            }),
          );
          return { dados: r.linhas[0] ?? null };
        } catch (e) {
          return traduzirErroDoBanco(e);
        }
      },
    };
  },
};

// ---- resposta.processar --------------------------------------------------------------------

const SchemaProcessar = z
  .object({
    id_resposta: inteiro,
    resultado: z
      .object({
        status_resposta: z.string(),
        motivo_tratamento: z.string().optional(),
        itens: z.array(
          z
            .object({
              id_item_resposta: inteiro,
              situacao: z.enum(['APROVADO', 'NAO_APROVADO']),
              id_faixa_preco_aceita: inteiro.nullable().optional(),
              preco_unitario_aceito: z.number().int().nonnegative().nullable().optional(),
              valor_imposto_aceito: z.number().int().nonnegative().nullable().optional(),
              valor_total_item_aceito: z.number().int().nonnegative().nullable().optional(),
            })
            .strict(),
        ),
        totais: z
          .object({
            valor_total_itens_aprovado: z.number().int().nonnegative(),
            valor_total_imposto_aprovado: z.number().int().nonnegative(),
            modalidade_frete_aceita: z.enum(['CIF', 'FOB']).nullable().optional(),
            valor_frete_aceito: z.number().int().nonnegative().nullable().optional(),
            valor_total_aceito: z.number().int().nonnegative().nullable().optional(),
          })
          .strict()
          .optional(),
        status_orcamento: z.enum(['ACEITO', 'RECUSADO', 'ALTERACAO_SOLICITADA', 'ABERTO']),
      })
      .strict(),
  })
  .strict();

export const respostaProcessar: Operacao = {
  id: 'resposta.processar',
  escrita: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaProcessar, payload);
    return {
      escopos: ['operacao:resposta.processar'],
      dominio: 'resposta_orcamento',
      async executar() {
        try {
          const r = await ctx.banco.transacao((tx) =>
            tx.consultar({
              texto: `SELECT * FROM ${aspas(FUNCAO_PROCESSAR)}(p_id_resposta => $1, p_resultado => $2::jsonb)`,
              valores: [p.id_resposta, JSON.stringify(p.resultado)],
            }),
          );
          return { dados: r.linhas[0] ?? null };
        } catch (e) {
          return traduzirErroDoBanco(e);
        }
      },
    };
  },
};
