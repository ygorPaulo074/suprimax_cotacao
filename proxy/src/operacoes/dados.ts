import { z } from 'zod';
import { AppError } from '../erros';
import { ESCOPO_CREDENCIAIS } from '../esquema/esquema';
import { possuiEscopo } from '../auth/escopos';
import { aspas, validarIdentificador } from '../sql/base';
import { codificarCursor, montarConsulta, type ParamsConsultar } from '../sql/consultar';
import { montarDelete, montarInsert, montarUpdate } from '../sql/escrita';
import type { Filtro } from '../sql/filtros';
import { verificarRiscoEscrita } from './risco';
import {
  analisar,
  type ContextoOperacao,
  type Operacao,
  type OperacaoPreparada,
  type ResultadoOperacao,
} from './tipos';

// Operações genéricas dados.* (docs/12, seção 12.8.2). Servem para qualquer tabela do esquema e
// dependem só do escopo `tabela:acao` do integrante.

const filtros = z.record(z.unknown());
const nomes = z.array(z.string()).max(100);

const SchemaConsultar = z
  .object({
    tabela: z.string(),
    campos: nomes.optional(),
    filtros: filtros.optional(),
    incluir: nomes.optional(),
    agrupar: nomes.optional(),
    agregacoes: z
      .array(z.object({ fn: z.string(), campo: z.string(), como: z.string() }).strict())
      .max(20)
      .optional(),
    ordenacao: z
      .array(z.tuple([z.string(), z.string()]))
      .max(10)
      .optional(),
    limite: z.number().optional(),
    cursor: z.string().optional(),
  })
  .strict();

const valores = z.record(z.unknown());
const SchemaInserir = z
  .object({
    tabela: z.string(),
    valores: z.union([valores, z.array(valores)]),
    retornar: nomes.optional(),
  })
  .strict();
const SchemaAtualizar = z
  .object({ tabela: z.string(), filtros: filtros.optional(), valores, retornar: nomes.optional() })
  .strict();
const SchemaExcluir = z.object({ tabela: z.string(), filtros: filtros.optional() }).strict();
const SchemaRpc = z
  .object({ funcao: z.string(), argumentos: z.record(z.unknown()).optional() })
  .strict();

interface DefinicaoDados<P> {
  schema: z.ZodType<P, z.ZodTypeDef, unknown>;
  escrita: boolean;
  tabela(p: P): string;
  escopos(p: P): string[];
  executar(p: P, ctx: ContextoOperacao): Promise<ResultadoOperacao>;
}

const DEFINICOES = {
  'dados.consultar': {
    schema: SchemaConsultar,
    escrita: false,
    tabela: (p) => p.tabela,
    escopos: (p) => [p.tabela, ...(p.incluir ?? [])].map((t) => `${t}:consultar`),
    async executar(p, ctx) {
      const m = montarConsulta(ctx.esquema, p as unknown as ParamsConsultar, {
        credenciais: ctx.credenciais,
      });
      const { linhas } = await ctx.banco.consultar(m.consulta);
      return {
        dados: linhas.slice(0, m.limite),
        proximo_cursor: linhas.length > m.limite ? codificarCursor(m.offset + m.limite) : null,
      };
    },
  } satisfies DefinicaoDados<z.infer<typeof SchemaConsultar>>,

  'dados.inserir': {
    schema: SchemaInserir,
    escrita: true,
    tabela: (p) => p.tabela,
    escopos: (p) => [`${p.tabela}:inserir`],
    async executar(p, ctx) {
      const r = await ctx.banco.consultar(montarInsert(ctx.esquema, p));
      return { dados: r.linhas, afetados: r.contagem };
    },
  } satisfies DefinicaoDados<z.infer<typeof SchemaInserir>>,

  'dados.atualizar': {
    schema: SchemaAtualizar,
    escrita: true,
    tabela: (p) => p.tabela,
    escopos: (p) => [`${p.tabela}:atualizar`],
    async executar(p, ctx) {
      return ctx.banco.transacao(async (tx) => {
        const sub = { ...ctx, banco: tx };
        await verificarRiscoEscrita(sub, p.tabela, p.filtros as Filtro | undefined);
        const r = await tx.consultar(
          montarUpdate(ctx.esquema, { ...p, filtros: p.filtros as Filtro }),
        );
        return { afetados: r.contagem, ...(p.retornar?.length ? { dados: r.linhas } : {}) };
      });
    },
  } satisfies DefinicaoDados<z.infer<typeof SchemaAtualizar>>,

  'dados.excluir': {
    schema: SchemaExcluir,
    escrita: true,
    tabela: (p) => p.tabela,
    escopos: (p) => [`${p.tabela}:excluir`],
    async executar(p, ctx) {
      return ctx.banco.transacao(async (tx) => {
        const sub = { ...ctx, banco: tx };
        await verificarRiscoEscrita(sub, p.tabela, p.filtros as Filtro | undefined);
        const r = await tx.consultar(
          montarDelete(ctx.esquema, { ...p, filtros: p.filtros as Filtro }),
        );
        return { afetados: r.contagem };
      });
    },
  } satisfies DefinicaoDados<z.infer<typeof SchemaExcluir>>,
};

type IdDados = keyof typeof DEFINICOES;
const IDS_DADOS = Object.keys(DEFINICOES) as IdDados[];

/** O integrante pode ler colunas sensíveis? Calculado a partir dos escopos do cadastro. */
export function podeLerCredenciais(escopos: string[]): boolean {
  return possuiEscopo(escopos, ESCOPO_CREDENCIAIS);
}

function preparar<P>(
  def: DefinicaoDados<P>,
  payload: unknown,
  ctx: ContextoOperacao,
): OperacaoPreparada {
  const p = analisar(def.schema, payload);
  return {
    escopos: def.escopos(p),
    dominio: def.tabela(p),
    executar: () => def.executar(p, ctx),
  };
}

export const dadosConsultar: Operacao = {
  id: 'dados.consultar',
  escrita: false,
  preparar: (payload, ctx) =>
    preparar(DEFINICOES['dados.consultar'] as DefinicaoDados<unknown>, payload, ctx),
};
export const dadosInserir: Operacao = {
  id: 'dados.inserir',
  escrita: true,
  preparar: (payload, ctx) =>
    preparar(DEFINICOES['dados.inserir'] as DefinicaoDados<unknown>, payload, ctx),
};
export const dadosAtualizar: Operacao = {
  id: 'dados.atualizar',
  escrita: true,
  preparar: (payload, ctx) =>
    preparar(DEFINICOES['dados.atualizar'] as DefinicaoDados<unknown>, payload, ctx),
};
export const dadosExcluir: Operacao = {
  id: 'dados.excluir',
  escrita: true,
  preparar: (payload, ctx) =>
    preparar(DEFINICOES['dados.excluir'] as DefinicaoDados<unknown>, payload, ctx),
};

// ---------------------------------------------------------------------------------------------
// dados.lote: vários passos numa transação única; se um falhar, nenhum é aplicado. Um passo pode
// usar o resultado de outro: "$p1.dados[0].id_pedido".

const MAXIMO_PASSOS = 20;
const SchemaLote = z
  .object({
    passos: z
      .array(
        z
          .object({
            id: z.string(),
            operacao: z.string(),
            payload: z.record(z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(MAXIMO_PASSOS),
  })
  .strict();

const REFERENCIA = /^\$([a-z_][a-z0-9_]*)\.(.+)$/;

function lerCaminho(origem: unknown, caminho: string): unknown {
  let atual: unknown = origem;
  for (const parte of caminho.match(/[^.[\]]+/g) ?? []) {
    if (atual === null || typeof atual !== 'object') return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/** Troca cada string "$passo.caminho" pelo valor do resultado do passo anterior. */
export function resolverReferencias(valor: unknown, resultados: Record<string, unknown>): unknown {
  if (typeof valor === 'string') {
    const m = REFERENCIA.exec(valor);
    if (!m) return valor;
    const [, passo = '', caminho = ''] = m;
    if (!(passo in resultados))
      throw new AppError('PAYLOAD_INVALIDO', undefined, `referência a passo inexistente: ${passo}`);
    const resolvido = lerCaminho(resultados[passo], caminho);
    if (resolvido === undefined)
      throw new AppError('PAYLOAD_INVALIDO', undefined, `referência sem valor: ${valor}`);
    return resolvido;
  }
  if (Array.isArray(valor)) return valor.map((v) => resolverReferencias(v, resultados));
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, resolverReferencias(v, resultados)]),
    );
  }
  return valor;
}

export const dadosLote: Operacao = {
  id: 'dados.lote',
  escrita: true,
  preparar(payload, ctx) {
    const { passos } = analisar(SchemaLote, payload);
    const vistos = new Set<string>();
    const planejados = passos.map((passo) => {
      validarIdentificador(passo.id, 'id do passo');
      if (vistos.has(passo.id))
        throw new AppError('PAYLOAD_INVALIDO', undefined, `passo repetido: ${passo.id}`);
      vistos.add(passo.id);
      if (!IDS_DADOS.includes(passo.operacao as IdDados)) {
        throw new AppError(
          'PAYLOAD_INVALIDO',
          undefined,
          `operação não permitida no lote: ${passo.operacao}`,
        );
      }
      return { passo, def: DEFINICOES[passo.operacao as IdDados] as DefinicaoDados<unknown> };
    });

    // Os escopos de todos os passos são conferidos antes de executar qualquer um. Referências só
    // aparecem em valores, então as tabelas já são conhecidas aqui.
    const escopos = planejados.flatMap(({ passo, def }) =>
      def.escopos(analisar(def.schema, passo.payload)),
    );

    return {
      escopos: [...new Set(escopos)],
      dominio: 'lote',
      executar: () =>
        ctx.banco.transacao(async (tx) => {
          const sub: ContextoOperacao = { ...ctx, banco: tx };
          const resultados: Record<string, unknown> = {};
          for (const { passo, def } of planejados) {
            const resolvido = resolverReferencias(passo.payload, resultados);
            resultados[passo.id] = {
              ok: true,
              ...(await def.executar(analisar(def.schema, resolvido), sub)),
            };
          }
          return { resultados };
        }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// dados.rpc: chama uma função do banco autorizada pelo escopo `rpc:<funcao>`.

export const dadosRpc: Operacao = {
  id: 'dados.rpc',
  escrita: true, // não se sabe se a função altera dados: passa pela fila por segurança
  preparar(payload, ctx) {
    const p = analisar(SchemaRpc, payload);
    const funcao = validarIdentificador(p.funcao, 'função');
    const argumentos = Object.entries(p.argumentos ?? {});
    return {
      escopos: [`rpc:${funcao}`],
      dominio: 'rpc',
      async executar() {
        const valores: unknown[] = [];
        const lista = argumentos.map(([nome, valor]) => {
          valores.push(valor);
          return `${aspas(validarIdentificador(nome, 'argumento'))} => $${valores.length}`;
        });
        const r = await ctx.banco.consultar({
          texto: `SELECT * FROM ${aspas(funcao)}(${lista.join(', ')})`,
          valores,
        });
        return { resultado: r.linhas };
      },
    };
  },
};
