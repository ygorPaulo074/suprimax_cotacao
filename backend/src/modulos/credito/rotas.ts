// UC07 — rotas de análise de crédito (docs/frontend-api.md, tela do fiscal).
import { Router } from 'express';
import { STATUS_HTTP } from '../../erros';
import { TIPOS_DE_DOCUMENTO_CREDITO } from './repositorio';
import { exigirPerfil, exigirSessao, obterSessao } from '../../http/middlewares/autenticacao';
import { rotaAssincrona } from '../../http/rotaAssincrona';
import { validarEntrada } from '../../http/validacao';
import { z } from 'zod';
import { esquemaDeParametroId } from '../comum/campos';
import {
  processarUploadComTiposAceitos,
  TIPOS_DE_CONTEUDO_DE_DOCUMENTO_DE_CREDITO,
} from '../comum/uploadDeArquivo';
import type { RepositorioDeSessoes } from '../auth/sessoes';
import { esquemaDeDocumentoRecebido, esquemaDeResultadoDeCredito } from './esquemas';
import type { ServicoDeAnaliseCredito } from './servico';

export const ROTAS_DE_CREDITO = {
  COLECAO: '/analises-credito',
  ITEM: '/analises-credito/:id',
  DOCUMENTOS: '/analises-credito/:id/documentos',
  DOCUMENTO_ARQUIVO: '/analises-credito/:id/documentos/:tipoDocumento/arquivo',
  RESULTADO: '/analises-credito/:id/resultado',
} as const;

const esquemaDeParametrosDoDocumento = esquemaDeParametroId.extend({
  tipoDocumento: z.enum(TIPOS_DE_DOCUMENTO_CREDITO),
});

export interface DependenciasDasRotasDeCredito {
  readonly servico: ServicoDeAnaliseCredito;
  readonly sessoes: RepositorioDeSessoes;
}

/**
 * Rotas de análise de crédito, todas restritas ao perfil FISCAL (UC07):
 * - `GET /analises-credito`: lista as análises;
 * - `GET /analises-credito/:id`: detalhe, com o checklist de documentos;
 * - `POST /analises-credito/:id/documentos`: marca um tipo de documento como recebido; aceita
 *   upload opcional (multipart, campo `arquivo`, até 10 MB), guardado no armazenamento privado;
 * - `GET /analises-credito/:id/documentos/:tipoDocumento/arquivo`: URL assinada de curta
 *   duração do arquivo digital (`{ url, expiraEm }`);
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
    processarUploadComTiposAceitos(TIPOS_DE_CONTEUDO_DE_DOCUMENTO_DE_CREDITO),
    rotaAssincrona(async (req, res) => {
      const { id } = validarEntrada(esquemaDeParametroId, req.params);
      const dados = validarEntrada(esquemaDeDocumentoRecebido, req.body);
      const arquivo = req.file && {
        nomeArquivo: req.file.originalname,
        tipoConteudo: req.file.mimetype,
        conteudo: req.file.buffer,
      };
      res.status(STATUS_HTTP.OK).json(await servico.registrarDocumento(id, dados, arquivo));
    }),
  );

  rotas.get(
    ROTAS_DE_CREDITO.DOCUMENTO_ARQUIVO,
    autenticado,
    somenteFiscal,
    rotaAssincrona(async (req, res) => {
      const { id, tipoDocumento } = validarEntrada(esquemaDeParametrosDoDocumento, req.params);
      res.status(STATUS_HTTP.OK).json(await servico.obterUrlDoDocumento(id, tipoDocumento));
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
