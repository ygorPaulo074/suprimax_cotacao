// UC07 — rotas de análise de crédito (docs/frontend-api.md, tela do fiscal).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import { esquemaDeParametroId } from '../comum/campos';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeDocumentoRecebido, esquemaDeResultadoDeCredito } from './esquemas';
import type { ServicoDeAnaliseCredito } from './servico';

export const ROTAS_DE_CREDITO = {
  COLECAO: '/analises-credito',
  ITEM: '/analises-credito/:id',
  DOCUMENTOS: '/analises-credito/:id/documentos',
  RESULTADO: '/analises-credito/:id/resultado',
} as const;

export interface DependenciasDasRotasDeCredito {
  readonly servico: ServicoDeAnaliseCredito;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de análise de crédito, todas restritas ao perfil FISCAL (UC07):
 * - `GET /analises-credito`: lista as análises;
 * - `GET /analises-credito/:id`: detalhe, com o checklist de documentos;
 * - `POST /analises-credito/:id/documentos`: marca um tipo de documento como recebido;
 * - `POST /analises-credito/:id/resultado`: registra o resultado (aprova ou reprova).
 */
export function criarRotasDeCredito({ servico, sessoes }: DependenciasDasRotasDeCredito): Router {
  const rotas = Router();
  const autenticado = exigirSessao(sessoes);
  const somenteFiscal = exigirPerfil('FISCAL');

  rotas.get(
    ROTAS_DE_CREDITO.COLECAO,
    autenticado,
    somenteFiscal,
    rotaAssincrona(async (_req, res) => {
      res.status(STATUS_HTTP.OK).json(await servico.listar());
    }),
  );

  rotas.get(
    ROTAS_DE_CREDITO.ITEM,
    autenticado,
    somenteFiscal,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obter(id));
    }),
  );

  rotas.post(
    ROTAS_DE_CREDITO.DOCUMENTOS,
    autenticado,
    somenteFiscal,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeDocumentoRecebido, req.body);
      res.status(STATUS_HTTP.OK).json(await servico.registrarDocumento(id, dados));
    }),
  );

  rotas.post(
    ROTAS_DE_CREDITO.RESULTADO,
    autenticado,
    somenteFiscal,
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const { resultado } = validarEntrada(esquemaDeResultadoDeCredito, req.body);
      res
        .status(STATUS_HTTP.OK)
        .json(await servico.registrarResultado(id, resultado, obterSessao(res)));
    }),
  );

  return rotas;
}
