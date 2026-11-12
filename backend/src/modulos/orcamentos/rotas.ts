// UC01, UC14-19 — rotas de orçamentos (docs/frontend-api.md).
//
// Anexos (`POST/.../anexos`, `DELETE /anexos/:id`), o PDF (`GET /pdf`) e o envio ao vendedor
// (`POST /enviar`, UC08) ficam fora desta entrega: dependem de `multer` e `pdfkit`, que ainda não
// estão no `package.json`, e de uma notificação ao vendedor que outro item ainda não define.
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeIdNaRota, esquemaDeParametroId } from '../comum/campos';
import {
  esquemaDeCabecalhoAtualizar,
  esquemaDeCancelamento,
  esquemaDeCondicoesAtualizar,
  esquemaDeFiltroDeOrcamentos,
  esquemaDeItemAdicionar,
  esquemaDeOrcamentoNovo,
  esquemaDeQuantidadeAlterar,
} from './esquemas';
import type { ServicoDeOrcamentos } from './servico';

export const ROTAS_DE_ORCAMENTOS = {
  COLECAO: '/orcamentos',
  ITEM: '/orcamentos/:id',
  ITENS: '/orcamentos/:id/itens',
  ITEM_DO_ORCAMENTO: '/orcamentos/:id/itens/:idItem',
  CONDICOES: '/orcamentos/:id/condicoes',
  EMITIR: '/orcamentos/:id/emitir',
  CANCELAR: '/orcamentos/:id/cancelar',
} as const;

const esquemaDeParametrosDoItem = esquemaDeParametroId.extend({ idItem: esquemaDeIdNaRota });

export interface DependenciasDasRotasDeOrcamentos {
  readonly servico: ServicoDeOrcamentos;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de orçamentos, para OPERADOR e OPERADOR_CHEFE:
 * - `GET /orcamentos` e `GET /orcamentos/:id`: listagem (UC01) e detalhe, com as condições
 *   comerciais e os bloqueios sempre recalculados;
 * - `POST /orcamentos`: novo orçamento do zero (UC14);
 * - `PATCH /orcamentos/:id`: cabeçalho;
 * - `POST`/`PATCH`/`DELETE` em `/itens`: inclusão, alteração de quantidade e remoção (UC15-17);
 * - `PUT /orcamentos/:id/condicoes`: condições comerciais (UC18);
 * - `POST /orcamentos/:id/emitir`: emissão (UC19), 422 com `detalhes.bloqueios` se houver
 *   pendência;
 * - `POST /orcamentos/:id/cancelar`: cancelamento, com justificativa opcional.
 */
export function criarRotasDeOrcamentos({
  servico,
  sessoes,
}: DependenciasDasRotasDeOrcamentos): Router {
  const rotas = Router();
  const operador = [exigirSessao(sessoes), exigirPerfil('OPERADOR', 'OPERADOR_CHEFE')];

  rotas.get(
    ROTAS_DE_ORCAMENTOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const filtro = validarEntrada(esquemaDeFiltroDeOrcamentos, req.query);
      res.status(STATUS_HTTP.OK).json(await servico.listar(filtro));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.COLECAO,
    operador,
    rotaAssincrona(async (req, res) => {
      const dados = validarEntrada(esquemaDeOrcamentoNovo, req.body);
      res.status(STATUS_HTTP.CRIADO).json(await servico.criar(dados, obterSessao(res)));
    }),
  );

  rotas.get(
    ROTAS_DE_ORCAMENTOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obter(id));
    }),
  );

  rotas.patch(
    ROTAS_DE_ORCAMENTOS.ITEM,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeCabecalhoAtualizar, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.atualizarCabecalho(id, dados, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.ITENS,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeItemAdicionar, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.adicionarItem(id, dados, obterSessao(res)));
    }),
  );

  rotas.patch(
    ROTAS_DE_ORCAMENTOS.ITEM_DO_ORCAMENTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id, idItem } = validarEntrada(esquemaDeParametrosDoItem, req.params);
      const { quantidade } = validarEntrada(esquemaDeQuantidadeAlterar, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.alterarQuantidade(id, idItem, quantidade, obterSessao(res)));
    }),
  );

  rotas.delete(
    ROTAS_DE_ORCAMENTOS.ITEM_DO_ORCAMENTO,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id, idItem } = validarEntrada(esquemaDeParametrosDoItem, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.removerItem(id, idItem, obterSessao(res)));
    }),
  );

  rotas.put(
    ROTAS_DE_ORCAMENTOS.CONDICOES,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeCondicoesAtualizar, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.atualizarCondicoes(id, dados, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.EMITIR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.emitir(id, obterSessao(res)));
    }),
  );

  rotas.post(
    ROTAS_DE_ORCAMENTOS.CANCELAR,
    operador,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const { justificativa } = validarEntrada(esquemaDeCancelamento, req.body);
      await servico.cancelar(id, justificativa ?? null, obterSessao(res));
      res.status(STATUS_HTTP.SEM_CONTEUDO).end();
    }),
  );

  return rotas;
}
