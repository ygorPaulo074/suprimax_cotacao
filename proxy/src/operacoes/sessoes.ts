import { z } from 'zod';
import { analisar, type Operacao } from './tipos';

// Sessões de login do Sistema 2 (UC13, RN02), na tabela `sessao` (migration 20261118000000_sessao).
//
// A tabela fica fora do dicionário de dados: dados.* a recusa, e só estas operações a acessam.
// O backend envia apenas o SHA-256 do token (64 hexadecimais); o token em si nunca chega aqui.
// O prazo (`expira_em`) é calculado e comparado com o relógio do banco, para não depender do
// relógio de quem chama. As operações são sigilosas: o payload, que tem o hash, não vai para a
// fila de escrita.

export const TABELA_SESSAO = 'sessao';

/** Prazo de inatividade aceito, em segundos: de 1 minuto a 1 dia (SESSAO_INATIVIDADE_MINUTOS). */
export const VALIDADE_MINIMA_SEGUNDOS = 60;
export const VALIDADE_MAXIMA_SEGUNDOS = 24 * 60 * 60;

const tokenHash = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 em hexadecimal minúsculo');
const validade = z.number().int().min(VALIDADE_MINIMA_SEGUNDOS).max(VALIDADE_MAXIMA_SEGUNDOS);
const inteiro = z.number().int().positive();

/** Colunas devolvidas pela busca: a sessão e os dados atuais do operador dono dela. */
const COLUNAS_DA_BUSCA =
  'o."id_operador", o."usuario", o."email", o."perfil", o."status", s."expira_em"';

// ---- sessao.criar --------------------------------------------------------------------------

const SchemaCriar = z
  .object({ token_hash: tokenHash, id_operador: inteiro, validade_segundos: validade })
  .strict();

export const sessaoCriar: Operacao = {
  id: 'sessao.criar',
  escrita: true,
  sigilosa: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaCriar, payload);
    return {
      escopos: ['operacao:sessao.criar'],
      dominio: TABELA_SESSAO,
      async executar() {
        const r = await ctx.banco.consultar({
          texto:
            'INSERT INTO "sessao" ("token_hash", "id_operador", "expira_em") ' +
            'VALUES ($1, $2, CURRENT_TIMESTAMP + make_interval(secs => $3)) RETURNING "expira_em"',
          valores: [p.token_hash, p.id_operador, p.validade_segundos],
        });
        return { dados: r.linhas[0] ?? null };
      },
    };
  },
};

// ---- sessao.buscar -------------------------------------------------------------------------

const SchemaBuscar = z
  .object({ token_hash: tokenHash, renovar_segundos: validade.optional() })
  .strict();

/**
 * Devolve a sessão vigente do hash, com os dados atuais do operador, ou `dados: null` se não
 * existir ou tiver vencido. Com `renovar_segundos`, empurra o prazo para agora + esse tempo (nunca
 * o encurta) na mesma instrução; sem ele, é só leitura e não passa pela fila.
 */
export const sessaoBuscar: Operacao = {
  id: 'sessao.buscar',
  escrita: true,
  sigilosa: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaBuscar, payload);
    const renovar = p.renovar_segundos !== undefined;
    return {
      escopos: ['operacao:sessao.buscar'],
      dominio: TABELA_SESSAO,
      somenteLeitura: !renovar,
      async executar() {
        const r = renovar
          ? await ctx.banco.consultar({
              texto:
                'WITH s AS (UPDATE "sessao" SET "expira_em" = GREATEST("expira_em", ' +
                'CURRENT_TIMESTAMP + make_interval(secs => $2)) ' +
                'WHERE "token_hash" = $1 AND "expira_em" > CURRENT_TIMESTAMP ' +
                'RETURNING "id_operador", "expira_em") ' +
                `SELECT ${COLUNAS_DA_BUSCA} FROM s JOIN "operador" o ON o."id_operador" = s."id_operador"`,
              valores: [p.token_hash, p.renovar_segundos],
            })
          : await ctx.banco.consultar({
              texto:
                `SELECT ${COLUNAS_DA_BUSCA} FROM "sessao" s ` +
                'JOIN "operador" o ON o."id_operador" = s."id_operador" ' +
                'WHERE s."token_hash" = $1 AND s."expira_em" > CURRENT_TIMESTAMP',
              valores: [p.token_hash],
            });
        return { dados: r.linhas[0] ?? null };
      },
    };
  },
};

// ---- sessao.encerrar, sessao.encerrar_operador, sessao.remover_expiradas -------------------

const SchemaEncerrar = z.object({ token_hash: tokenHash }).strict();

/** Logout: apaga a sessão do hash. Hash desconhecido não é erro (`afetados: 0`). */
export const sessaoEncerrar: Operacao = {
  id: 'sessao.encerrar',
  escrita: true,
  sigilosa: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaEncerrar, payload);
    return {
      escopos: ['operacao:sessao.encerrar'],
      dominio: TABELA_SESSAO,
      async executar() {
        const r = await ctx.banco.consultar({
          texto: 'DELETE FROM "sessao" WHERE "token_hash" = $1',
          valores: [p.token_hash],
        });
        return { afetados: r.contagem };
      },
    };
  },
};

const SchemaEncerrarOperador = z.object({ id_operador: inteiro }).strict();

/** Apaga todas as sessões de um operador (inativação, troca de perfil, senha redefinida). */
export const sessaoEncerrarOperador: Operacao = {
  id: 'sessao.encerrar_operador',
  escrita: true,
  sigilosa: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaEncerrarOperador, payload);
    return {
      escopos: ['operacao:sessao.encerrar_operador'],
      dominio: TABELA_SESSAO,
      async executar() {
        const r = await ctx.banco.consultar({
          texto: 'DELETE FROM "sessao" WHERE "id_operador" = $1',
          valores: [p.id_operador],
        });
        return { afetados: r.contagem };
      },
    };
  },
};

const SchemaRemoverExpiradas = z.object({}).strict();

/** Limpeza periódica: apaga as sessões vencidas (chamada pelos jobs do backend). */
export const sessaoRemoverExpiradas: Operacao = {
  id: 'sessao.remover_expiradas',
  escrita: true,
  sigilosa: true,
  preparar(payload, ctx) {
    analisar(SchemaRemoverExpiradas, payload);
    return {
      escopos: ['operacao:sessao.remover_expiradas'],
      dominio: TABELA_SESSAO,
      async executar() {
        const r = await ctx.banco.consultar({
          texto: 'DELETE FROM "sessao" WHERE "expira_em" <= CURRENT_TIMESTAMP',
          valores: [],
        });
        return { afetados: r.contagem };
      },
    };
  },
};

export const OPERACOES_DE_SESSAO: Operacao[] = [
  sessaoCriar,
  sessaoBuscar,
  sessaoEncerrar,
  sessaoEncerrarOperador,
  sessaoRemoverExpiradas,
];
