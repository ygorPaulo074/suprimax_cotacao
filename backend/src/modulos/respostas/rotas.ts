// UC20, UC21 — rotas de respostas pendentes (docs/frontend-api.md, linhas 46-48).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeParametroId } from '../comum/campos';
import { esquemaDeFiltroDeRespostas } from './esquemas';
import type { ServicoDeRespostas } from './servico';

export const ROTAS_DE_RESPOSTAS = {
  COLECAO: '/respostas-pendentes',
  CONTADOR: '/respostas-pendentes/contador',
  ITEM: '/respostas-pendentes/:id',
  TRATAR_SEM_NOVA_VERSAO: '/respostas-pendentes/:id/tratar-sem-nova-versao',
  RASCUNHO: '/respostas-pendentes/:id/rascunho',
  EMITIR_NOVA_VERSAO: '/respostas-pendentes/:id/emitir-nova-versao',
} as const;

export interface DependenciasDasRotasDeRespostas {
  readonly servico: ServicoDeRespostas;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de respostas pendentes (UC21), para OPERADOR e OPERADOR_CHEFE:
 * - `GET /respostas-pendentes`: lista as que aguardam tratamento, com os filtros da tela (RF27);
 * - `GET /respostas-pendentes/contador`: contador do menu;
 * - `GET /respostas-pendentes/:id`: abre o tratamento, criando ou retomando o rascunho da nova
 *   versão;
 * - `POST .../tratar-sem-nova-versao`: conclui sem reestruturar (recusa sem nova versão, UC21-A1);
 * - `DELETE .../rascunho`: descarta o rascunho da nova versão (UC21-A2), via cancelamento comum
 *   (UC06); a resposta continua aguardando tratamento;
 * - `POST .../emitir-nova-versao`: emite a nova versão e substitui o original.
 */
export function criarRotasDeRespostas({
  servico,
  sessoes,
}: DependenciasDasRotasDeRespostas): Router {
  const rotas = Router();
  const operador = [exigirSessao(sessoes), exigirPerfil('OPERADOR', 'OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_RESPOSTAS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const filtro = validarEntrada(esquemaDeFiltroDeRespostas, req.query);
      res.status(STATUS_HTTP.OK).json(await servico.listarPendentes(filtro));
    }),
  );

  rotas.get(
    ROTAS_DE_RESPOSTAS.CONTADOR,
    operador,
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json({ total: await servico.contarPendentes() });
    }),
  );

  rotas.get(
    ROTAS_DE_RESPOSTAS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obterDetalhe(id, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_RESPOSTAS.TRATAR_SEM_NOVA_VERSAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      await servico.tratarSemNovaVersao(id, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  rotas.delete(
    ROTAS_DE_RESPOSTAS.RASCUNHO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      await servico.descartarRascunho(id, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  rotas.post(
    ROTAS_DE_RESPOSTAS.EMITIR_NOVA_VERSAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.emitirNovaVersao(id, obterSessao(res)));
    }),
  );

  return rotas;
}
