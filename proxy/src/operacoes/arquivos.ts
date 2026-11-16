import { z } from 'zod';
import {
  caminhoValido,
  EXPIRA_MAXIMO_SEGUNDOS,
  EXPIRA_PADRAO_SEGUNDOS,
  PREFIXO_CAMINHO,
} from '../armazenamento/armazenamento';
import { AppError } from '../erros';
import { analisar, type ContextoOperacao, type Operacao } from './tipos';

// Operações de arquivos: anexos (UC19, RF11) e documentos de crédito (UC07; docs/12, seção 12.8.3). O conteúdo em base64 e as URLs
// assinadas nunca vão para log ou auditoria: a auditoria guarda só operação, resultado e duração.

const CaminhoSchema = z
  .string()
  .min(PREFIXO_CAMINHO.length + 1)
  .max(500)
  .refine(caminhoValido);

function armazenamento(ctx: ContextoOperacao) {
  if (!ctx.armazenamento) throw new AppError('INTERNAL_ERROR', undefined, 'Storage ausente');
  return ctx.armazenamento;
}

const SchemaSalvar = z
  .object({
    // Exatamente um: anexo de orçamento (UC19) ou documento de análise de crédito (UC07).
    id_orcamento: z.number().int().positive().optional(),
    id_analise_credito: z.number().int().positive().optional(),
    nome_arquivo: z.string().min(1).max(255),
    tipo_conteudo: z.string().min(1).max(100),
    // 10 MB decodificados = ~13,4 milhões de caracteres base64; o tamanho exato é conferido ao decodificar.
    conteudo_base64: z.string().min(1).max(14_000_000),
  })
  .strict()
  .refine((p) => (p.id_orcamento === undefined) !== (p.id_analise_credito === undefined), {
    message: 'informe exatamente um de id_orcamento e id_analise_credito',
  });

export const arquivoSalvar: Operacao = {
  id: 'arquivo.salvar',
  escrita: false,
  preparar(payload, ctx) {
    const p = analisar(SchemaSalvar, payload);
    return {
      escopos: ['operacao:arquivo.salvar'],
      dominio: 'arquivo',
      async executar() {
        const caminho = await armazenamento(ctx).salvar({
          idOrcamento: p.id_orcamento,
          idAnaliseCredito: p.id_analise_credito,
          nomeArquivo: p.nome_arquivo,
          tipoConteudo: p.tipo_conteudo,
          conteudoBase64: p.conteudo_base64,
        });
        return { dados: { caminho } };
      },
    };
  },
};

const SchemaRemover = z.object({ caminho: CaminhoSchema }).strict();

export const arquivoRemover: Operacao = {
  id: 'arquivo.remover',
  escrita: false,
  preparar(payload, ctx) {
    const p = analisar(SchemaRemover, payload);
    return {
      escopos: ['operacao:arquivo.remover'],
      dominio: 'arquivo',
      async executar() {
        await armazenamento(ctx).remover(p.caminho);
        return {};
      },
    };
  },
};

const SchemaAssinar = z
  .object({
    caminho: CaminhoSchema,
    expira_em_segundos: z.number().int().positive().max(EXPIRA_MAXIMO_SEGUNDOS).optional(),
  })
  .strict();

export const arquivoAssinar: Operacao = {
  id: 'arquivo.assinar',
  escrita: false,
  preparar(payload, ctx) {
    const p = analisar(SchemaAssinar, payload);
    return {
      escopos: ['operacao:arquivo.assinar'],
      dominio: 'arquivo',
      async executar() {
        const dados = await armazenamento(ctx).assinar(
          p.caminho,
          p.expira_em_segundos ?? EXPIRA_PADRAO_SEGUNDOS,
        );
        return { dados };
      },
    };
  },
};
