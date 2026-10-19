import { z } from 'zod';
import { AppError } from '../erros';
import { validarEscopos } from '../auth/escopos';
import { emitirToken, hashToken, novoServiceId } from '../auth/token';
import { analisar, type Operacao } from './tipos';

// Administração de integrantes (docs/12, seção 12.8.4). Exige a chave mestra (PROXY_ADMIN_KEY).
// O token só aparece na resposta de integrante.criar; no banco fica apenas o hash.

const VALIDADE_PADRAO_DIAS = 180;

const SchemaCriar = z
  .object({
    nome_sistema: z.string().trim().min(1).max(60),
    escopos: z.array(z.string()).min(1).max(200),
    expira_em: z.string().datetime().optional(),
  })
  .strict();

export const integranteCriar: Operacao = {
  id: 'integrante.criar',
  admin: true,
  escrita: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaCriar, payload);
    validarEscopos(p.escopos);
    return {
      escopos: [],
      dominio: 'integrantes_proxy',
      async executar() {
        const agora = ctx.deps.agora();
        const expiraEm = p.expira_em
          ? new Date(p.expira_em)
          : new Date(agora.getTime() + VALIDADE_PADRAO_DIAS * 24 * 60 * 60 * 1000);
        if (expiraEm <= agora)
          throw new AppError('PAYLOAD_INVALIDO', undefined, 'expira_em no passado');

        const id = novoServiceId();
        const token = emitirToken(ctx.deps.segredoJwt, {
          serviceId: id,
          escopos: p.escopos,
          expiraEm,
        });
        await ctx.deps.integrantes.criar({
          id,
          nomeSistema: p.nome_sistema,
          chaveHash: hashToken(token),
          escopos: p.escopos,
          ativo: true,
          criadoEm: agora,
          expiraEm,
        });
        return { dados: { service_id: id, token, expira_em: expiraEm.toISOString() } };
      },
    };
  },
};

const SchemaRevogar = z.object({ service_id: z.string().min(1).max(100) }).strict();

export const integranteRevogar: Operacao = {
  id: 'integrante.revogar',
  admin: true,
  escrita: true,
  preparar(payload, ctx) {
    const p = analisar(SchemaRevogar, payload);
    return {
      escopos: [],
      dominio: 'integrantes_proxy',
      async executar() {
        if (!(await ctx.deps.integrantes.revogar(p.service_id))) throw new AppError('NOT_FOUND');
        return {};
      },
    };
  },
};
